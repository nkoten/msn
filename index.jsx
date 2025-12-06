

// index.jsx
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";

// MegaDesdobramentoApp.jsx
// Single-file React component (Tailwind-ready)
// - Recebe números do usuário (6-20)
// - Gera desdobramento (todas as combinações de 6)
// - Filtra padrões ruins (sequências, todos abaixo de 32 ("datas"), todos pares/ímpares, sequências completas)
// - Remove combinações que já saíram (consulta API pública da Caixa / fallback)
// - Salva combinações válidas em localStorage
// - Permite agendar/definir data-hora do sorteio e, após a data, checar resultados e mostrar quantidade de acertos

// Observações:
// - Este componente tenta buscar resultados históricos da Mega-Sena usando a API pública da Caixa
//   (https://servicebus2.caixa.gov.br/portaldeloterias/api/megasena) – caso a requisição seja bloqueada por CORS,
//   o código trabalha com um fallback para outras APIs públicas ou pode ser usado por trás de um proxy.

// Helper: gera combinações k de um array arr (retorna arrays ordenados)
function combinations(arr, k) {
  const n = arr.length;
  if (k > n) return [];
  const res = [];
  const combo = Array.from({ length: k }, (_, i) => i);
  while (true) {
    res.push(combo.map((i) => arr[i]));
    let i = k - 1;
    while (i >= 0 && combo[i] === i + n - k) i--;
    if (i < 0) break;
    combo[i]++;
    for (let j = i + 1; j < k; j++) combo[j] = combo[j - 1] + 1;
  }
  return res;
}

// Helpers de filtro
function isConsecutive(combo, minLength = 3) {
  // verifica se existe uma sequência de pelo menos minLength números consecutivos (ex: 7,8,9)
  const sorted = combo.slice().sort((a, b) => a - b);
  let count = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      count++;
      if (count >= minLength) return true;
    } else {
      count = 1;
    }
  }
  return false;
}

function allBelowOrEqual(combo, value = 31) {
  return combo.every((n) => n <= value);
}

function allEven(combo) {
  return combo.every((n) => n % 2 === 0);
}
function allOdd(combo) {
  return combo.every((n) => n % 2 === 1);
}

function isSimpleSequence(combo) {
  // casos óbvios como 1,2,3,4,5,6 ou qualquer sequência completa de 6 números
  const s = combo.slice().sort((a, b) => a - b);
  for (let i = 1; i < s.length; i++) {
    if (s[i] !== s[i - 1] + 1) return false;
  }
  return true;
}

function comboKey(combo) {
  return combo.slice().sort((a, b) => a - b).join(",");
}

export default function MegaDesdobramentoApp() {
  const [input, setInput] = useState("");
  const [numbers, setNumbers] = useState([]);
  const [desdobramento, setDesdobramento] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [apiDraws, setApiDraws] = useState([]); // draws from API
  const [drawDate, setDrawDate] = useState(""); // yyyy-mm-ddThh:mm
  const [numerosProvaveis, setNumerosProvaveis] = useState([]);
  const [resultsChecked, setResultsChecked] = useState([]);
  const [loading, setLoading] = useState(false);
  const STORAGE_KEY = "mega_desdobramento_games";

  useEffect(() => {
    // load saved combos from localStorage
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setFiltered(parsed);
      } catch (e) {
        console.warn("localStorage parse error", e);
      }
    }
  }, []);

  // tentativa de buscar resultados históricos (usaremos esta lista para filtrar combinações já sorteadas)
  async function fetchDraws() {
    setLoading(true);
    const endpoints = [
      // Caixa oficial (padrão)
      "https://servicebus2.caixa.gov.br/portaldeloterias/api/megasena",
      // fallback (APIs públicas que replicam dados da Caixa)
      "https://api.guidi.dev.br/loteria/megasena",
      "https://lottolookup.com.br/api/megasena",
      "https://apiloterias.com.br/megasena",
    ];
    let draws = [];
    for (const url of endpoints) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = await res.json();
        // data pode vir em formatos diferentes: array de concursos ou objeto com propriedade 'lista' ou 'dezenas'
        if (Array.isArray(data)) {
          draws = data;
        } else if (data && data.listaDezenas) {
          draws = data.listaDezenas; // hipótese
        } else if (data && data.concursos) {
          draws = data.concursos;
        } else if (data && data[0] && data[0].dezenas) {
          draws = data;
        } else if (data && data.dezenas) {
          // caso API retorne um concurso específico
          draws = [data];
        } else {
          // tente extrair propriedades comuns
          const maybe = Object.values(data).flat?.() || [];
          if (maybe.length && maybe[0] && maybe[0].dezenas) draws = maybe;
        }
        if (draws.length) break; // sucesso
      } catch (e) {
        // console.warn("fetch draws failed for", url, e);
      }
    }
    // normalize draws -> array of {numero: <concurso>, data: 'yyyy-mm-dd', dezenas: [1..6]}
    const normalized = draws
      .map((d) => {
        // possible shapes: {dezenas: ['01','02',...], numeroDoConcurso, dataApuracao}
        const dezenas = d.dezenas || d.listaDezenas || d.numeros || d.premio || d.resultado || d; // fallback
        let arr = [];
        if (Array.isArray(d.dezenas)) arr = d.dezenas.map((z) => Number(String(z).padStart(2, "0")));
        else if (Array.isArray(d.listaDezenas)) arr = d.listaDezenas.map(Number);
        else if (Array.isArray(d.numeros)) arr = d.numeros.map(Number);
        else if (Array.isArray(d)) arr = d.map(Number);
        else if (d[0] && Array.isArray(d[0])) arr = d[0].map(Number);
        else arr = [];
        // if arr is empty but existe 'dezenas' string
        if (!arr.length && typeof d.dezenas === "string") {
          arr = d.dezenas.split(/[^0-9]+/).filter(Boolean).map(Number);
        }
        const date = d.dataApuracao || d.data || d.dataPorExtenso || d.dataSorteio || null;
        const concurso = d.numeroDoConcurso || d.numero || d.concurso || d.id || null;
        return { concurso, date, dezenas: arr };
      })
      .filter((x) => x.dezenas && x.dezenas.length >= 6);

    setApiDraws(normalized);
    setLoading(false);
    return normalized;
  }

  // gera desdobramento: todas as combinações de 6 números a partir dos números escolhidos
  function gerarDesdobramentoFromNumbers(nums) {
    if (nums.length < 6) return [];
    const combs = combinations(nums.slice().sort((a, b) => a - b), 6);
    setDesdobramento(combs);
    return combs;
  }

  // aplicar filtros sobre um conjunto de combinações
  function aplicarFiltros(combs, drawsNormalized = []) {
    const pastSet = new Set(drawsNormalized.map((d) => comboKey(d.dezenas.slice(0, 6))));
    const filtered = [];
    for (const c of combs) {
      const key = comboKey(c);
      // 1) remover se a combinação já saiu
      if (pastSet.has(key)) continue;
      // 2) remover sequências completas de 6
      if (isSimpleSequence(c)) continue;
      // 3) remover se tiver sequência de 3 ou mais números consecutivos (configurável)
      if (isConsecutive(c, 3)) continue;
      // 4) remover se todos estão abaixo ou iguais a 31 (evitar datas)
      if (allBelowOrEqual(c, 31)) continue;
      // 5) remover todos pares ou todos ímpares
      if (allEven(c) || allOdd(c)) continue;
      filtered.push(c);
    }
    return filtered;
  }

  async function handleGenerate(e) {
    e && e.preventDefault();
    // parse input numbers
    const parts = input
      .split(/[ ,;]+/)
      .map((t) => Number(t.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);
    const unique = Array.from(new Set(parts)).sort((a, b) => a - b);
    if (unique.length < 6) {
      alert("Insira ao menos 6 números válidos entre 1 e 60.");
      return;
    }
    if (unique.length > 20) {
      alert("Máximo 20 números permitidos pelo volante (o desdobramento pode ficar muito grande).\nPor favor reduza para no máximo 20 números.");
      return;
    }
    setNumbers(unique);
    setLoading(true);
    const combs = gerarDesdobramentoFromNumbers(unique);
    // buscar resultados históricos para remover combinações já sorteadas
    const draws = await fetchDraws();
    const final = aplicarFiltros(combs, draws);
    setFiltered(final);
    // salvar entrada completa no histórico
    const historyKey = "mega_desdobramento_history";
    const entry = { inputNumbers: unique, totalCombinacoes: combs.length, totalFiltradas: final.length, totalRemovidas: combs.length - final.length, geradoEm: new Date().toISOString() };
    const prev = JSON.parse(localStorage.getItem(historyKey) || "[]");
    prev.push(entry);
    localStorage.setItem(historyKey, JSON.stringify(prev));
    // salvar em localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(final));
    setLoading(false);
  }

  // verifica se alguma combinação obteve 4/5/6 acertos contra um concurso específico
  function checkCombosAgainstDraw(combos, drawDezenas) {
    const drawSet = new Set(drawDezenas.map((n) => Number(n)));
    return combos.map((c) => {
      const hits = c.reduce((acc, n) => acc + (drawSet.has(n) ? 1 : 0), 0);
      return { combo: c.slice().sort((a, b) => a - b), hits };
    });
  }

  async function handleCheckResults() {
    setLoading(true);
    // tenta buscar último concurso (mesma função de fetchDraws)
    const draws = await fetchDraws();
    if (!draws.length) {
      alert("Não foi possível obter resultados históricos (verifique CORS ou conexão). Veja logs no console.");
      setLoading(false);
      return;
    }
    const latest = draws[0]; // assumimos que o array vem do mais recente para o mais antigo
    if (!latest || !latest.dezenas || latest.dezenas.length < 6) {
      alert("Formato inesperado do resultado retornado pela API.");
      setLoading(false);
      return;
    }
    const check = checkCombosAgainstDraw(filtered, latest.dezenas.slice(0, 6));
    setResultsChecked({ concurso: latest.concurso || "último", date: latest.date, combos: check });
    setLoading(false);
  }

  function downloadJSON() {
    const data = { numbers, generatedAt: new Date().toISOString(), combos: filtered };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mega_desdobramento.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearStorage() {
    localStorage.removeItem(STORAGE_KEY);
    setFiltered([]);
    setDesdobramento([]);
    setNumbers([]);
    setInput("");
  }

  const removedCount = desdobramento.length - filtered.length;

  function calcularProvaveis() {
    if (!apiDraws.length) return alert("Atualize os concursos primeiro.");
    const freq = Array(61).fill(0);
    apiDraws.forEach(d => d.dezenas.forEach(n => freq[n]++));
    const ranked = [...Array(60).keys()].map(n=>n+1).sort((a,b)=>freq[b]-freq[a]);
    setNumerosProvaveis(ranked.slice(0,30));
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Mega-Sena — Gerador de Desdobramento</h1>
      <p className="mb-4 text-sm text-gray-600">
        Insira entre 6 e 20 números (1–60). O app vai gerar todas as combinações possíveis de 6 (desdobramento),
        filtrar padrões ruins e remover combinações que já saíram nos concursos históricos.
      </p>

      <form onSubmit={handleGenerate} className="space-y-3 mb-4">
        <label className="block">
          <span className="text-sm font-medium">Números (separados por espaço, vírgula ou ponto e vírgula)</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ex: 05 12 23 34 45 56"
            className="mt-1 block w-full rounded-md border p-2"
          />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={calcularProvaveis} className="px-4 py-2 rounded bg-purple-600 text-white">Números Prováveis (30+)</button>
          <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-blue-600 text-white flex items-center gap-2 disabled:opacity-50">{loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}Gerar desdobramento</button>
          <button type="button" onClick={fetchDraws} disabled={loading} className="px-4 py-2 rounded bg-gray-200 flex items-center gap-2 disabled:opacity-50">{loading && <span className="w-4 h-4 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></span>}Atualizar concursos (fetch)</button>
          <button type="button" onClick={downloadJSON} className="px-4 py-2 rounded bg-green-600 text-white">Baixar JSON</button>
          <button type="button" onClick={clearStorage} className="px-4 py-2 rounded bg-red-500 text-white">Limpar</button>
        </div>
      </form>

      <div className="mb-4">
        <strong>Quantidade de números escolhidos: </strong>{numbers.length}<br/>
        <strong>Números escolhidos: </strong>{numbers.join(", ")} 
        <br />
        <strong>Combinações geradas (C(n,6)): </strong>{desdobramento.length}
        <br />
        <strong>Após filtros e remoção de resultados já sorteados: </strong>{filtered.length}
        <br />
        <strong>Combinações removidas pelos filtros: </strong>{removedCount}
      </div>

      <div className="mb-6">
        <h2 className="font-semibold">Amostra das combinações filtradas (primeiras 200)</h2>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.slice(0, 200).map((c, i) => (
            <div key={i} className="p-2 border rounded">{c.slice().sort((a,b)=>a-b).join(", ")}</div>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <h2 className="font-semibold">Verificar resultados</h2>
        <p className="text-sm text-gray-600 mb-2">Defina a data/hora do sorteio (opcional) ou clique para checar o último concurso agora:</p>
        <div className="flex gap-2 mb-2">
          <input type="datetime-local" value={drawDate} onChange={(e)=>setDrawDate(e.target.value)} className="rounded border p-2" />
          <button type="button" onClick={handleCheckResults} disabled={loading} className="px-4 py-2 rounded bg-indigo-600 text-white flex items-center gap-2 disabled:opacity-50">{loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}Checar agora</button>
        </div>
        <div className="text-sm text-gray-600">
          {drawDate && new Date(drawDate) > new Date() ? (
            <div>Data do sorteio definida para: {new Date(drawDate).toLocaleString()}</div>
          ) : drawDate ? (
            <div>Data do sorteio ({new Date(drawDate).toLocaleString()}) já passou — você pode checar os resultados.</div>
          ) : null}
        </div>
      </div>

      <div>
        {loading && <div className="text-sm text-gray-600 mb-2">Processando...</div>}
        {resultsChecked && resultsChecked.combos && (
          <div>
            <h3 className="font-semibold">Resultado verificado — concurso: {resultsChecked.concurso} — data: {resultsChecked.date}</h3>
            <div className="mt-2">
              <strong>Resumo:</strong>
              <ul className="list-disc pl-6">
                <li>Combinações com 6 acertos: {resultsChecked.combos.filter(c=>c.hits===6).length}</li>
                <li>Combinações com 5 acertos: {resultsChecked.combos.filter(c=>c.hits===5).length}</li>
                <li>Combinações com 4 acertos: {resultsChecked.combos.filter(c=>c.hits===4).length}</li>
              </ul>
            </div>
            <div className="mt-4">
              <h4 className="font-medium">Listagem (apenas combos com 4+ acertos)</h4>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {resultsChecked.combos.filter(c=>c.hits>=4).map((c,i)=> (
                  <div key={i} className="p-2 border rounded">{c.combo.join(", ")} — {c.hits} acertos</div>
                ))}
              </div>

      {numerosProvaveis.length > 0 && (
        <div className="mt-6 p-4 border rounded bg-purple-50">
          <h3 className="font-semibold mb-2">30 números mais prováveis</h3>
          <p className="text-sm mb-2 text-gray-700">Com base na frequência histórica.</p>
          <div className="grid grid-cols-6 gap-2 text-center">
            {numerosProvaveis.map((n,i)=>(
              <div key={i} className="p-2 bg-white border rounded">{n}</div>
            ))}
          </div>
        </div>
      )}
    </div></div>
        )}
      </div>

      <div className="mt-8 text-xs text-gray-500">
        Nota técnica: o app tenta utilizar a API oficial disponibilizada pela Caixa para obter concursos
        (endereço padrão: https://servicebus2.caixa.gov.br/portaldeloterias/api/megasena). Em alguns ambientes
        (ex.: execução local no navegador) essa requisição pode ser bloqueada por políticas de CORS. Se isso
        acontecer, rode um pequeno proxy (ou use um servidor backend) para consultar a API e repassar ao
        frontend. Veja também alternativas públicas que replicam os resultados (APIs de terceiros).
      </div>
    </div>
  );
}

const appRoot = document.querySelector( "#app_root" );
!appRoot ? console.error( "appRoot not found" )
  : createRoot( appRoot ).render( <MegaDesdobramentoApp /> );

