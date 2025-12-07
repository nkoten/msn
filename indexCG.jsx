import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";

/******************************************************************
 *  FUNÇÕES AUXILIARES
 ******************************************************************/

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

function isConsecutive(combo, minLength = 3) {
  const sorted = combo.slice().sort((a, b) => a - b);
  let count = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      count++;
      if (count >= minLength) return true;
    } else count = 1;
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
  const s = combo.slice().sort((a, b) => a - b);
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1] + 1) return false;
  return true;
}

function comboKey(combo) {
  return combo.slice().sort((a, b) => a - b).join(",");
}

/******************************************************************
 *  CONSTANTES DA API
 ******************************************************************/

const BASE_CONCURSO = "https://api.guidi.dev.br/loteria/megasena";
const URL_ULTIMO = `${BASE_CONCURSO}/ultimo`;

/******************************************************************
 *  COMPONENTE PRINCIPAL
 ******************************************************************/

export default function MegaDesdobramentoApp() {
  const [input, setInput] = useState("");
  const [numbers, setNumbers] = useState([]);
  const [desdobramento, setDesdobramento] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [apiDraws, setApiDraws] = useState([]);
  const [fetchStatus, setFetchStatus] = useState("none"); // none | ok | fail
  const [drawDate, setDrawDate] = useState("");
  const [numerosProvaveis, setNumerosProvaveis] = useState([]);
  const [resultsChecked, setResultsChecked] = useState([]);
  const [loading, setLoading] = useState(false);

  const STORAGE_KEY = "mega_desdobramento_games";


  /******************************************************************
   *  CARREGAR DO LOCALSTORAGE
   ******************************************************************/
  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setFiltered(JSON.parse(raw));
      } catch {}
    }
  }, []);


  /******************************************************************
   *  FUNÇÃO ✔ FETCH ATUALIZADA — 100% FUNCIONAL COM API GUIDI
   ******************************************************************/

  async function fetchDraws() {
    setLoading(true);
    setFetchStatus("loading");

    let concursos = [];

    // 1) Buscar último concurso válido
    let ultimo = null;

    try {
      const r = await fetch(URL_ULTIMO);
      if (r.ok) {
        const d = await r.json();
        ultimo = d.numero ?? d.concurso ?? d.numeroDoConcurso ?? null;
      }
    } catch {}

    if (!ultimo) {
      setFetchStatus("fail");
      setLoading(false);
      return [];
    }

    // 2) Buscar até 50 concursos para trás
    const start = ultimo - 49;

    for (let n = ultimo; n >= start; n--) {
      try {
        const r = await fetch(`${BASE_CONCURSO}/${n}`);
        if (!r.ok) continue;

        const data = await r.json();
        if (data.dezenas || data.dezenasSorteadasOrdemSorteio) {
          const dezenas = data.dezenas
            ? data.dezenas.map(Number)
            : data.dezenasSorteadasOrdemSorteio.map(Number);

          concursos.push({
            concurso: data.numero ?? data.concurso ?? n,
            dezenas,
            date: data.dataApuracao ?? null,
          });
        }
      } catch {}
    }

    if (concursos.length === 0) {
      setFetchStatus("fail");
      setLoading(false);
      return [];
    }

    // Ordena do mais recente → mais antigo
    concursos.sort((a, b) => b.concurso - a.concurso);

    setApiDraws(concursos);
    setFetchStatus("ok");
    localStorage.setItem("mega_draws_cache", JSON.stringify(concursos));
    setLoading(false);

    return concursos;
  }


  /******************************************************************
   *  GERAR DESDOBRAMENTO
   ******************************************************************/

  function gerarDesdobramentoFromNumbers(nums) {
    const combs = combinations(nums.sort((a, b) => a - b), 6);
    setDesdobramento(combs);
    return combs;
  }

  function aplicarFiltros(combs, drawsNormalized = []) {
    const pastSet = new Set(
      drawsNormalized.map((d) => comboKey(d.dezenas.slice(0, 6)))
    );

    const f = [];

    for (const c of combs) {
      const key = comboKey(c);
      if (pastSet.has(key)) continue;
      if (isSimpleSequence(c)) continue;
      if (isConsecutive(c, 3)) continue;
      if (allBelowOrEqual(c, 31)) continue;
      if (allEven(c) || allOdd(c)) continue;
      f.push(c);
    }
    return f;
  }

  async function handleGenerate(e) {
    e && e.preventDefault();

    const parts = input
      .split(/[ ,;]+/)
      .map((n) => Number(n))
      .filter((n) => n >= 1 && n <= 60);

    const unique = [...new Set(parts)].sort((a, b) => a - b);

    if (unique.length < 6) return alert("Digite ao menos 6 números.");
    if (unique.length > 20) return alert("Máximo de 20 números.");

    setNumbers(unique);

    setLoading(true);

    const combs = gerarDesdobramentoFromNumbers(unique);

    const draws =
      apiDraws.length > 0
        ? apiDraws
        : await fetchDraws();

    const final = aplicarFiltros(combs, draws);
    setFiltered(final);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(final));

    setLoading(false);
  }

  /******************************************************************
   *  CHECAR RESULTADOS
   ******************************************************************/

  function checkCombosAgainstDraw(combos, drawDezenas) {
    const set = new Set(drawDezenas);
    return combos.map((c) => ({
      combo: c,
      hits: c.filter((n) => set.has(n)).length,
    }));
  }

  async function handleCheckResults() {
    setLoading(true);

    const draws =
      apiDraws.length > 0
        ? apiDraws
        : await fetchDraws();

    if (!draws.length) {
      setLoading(false);
      return alert("Nenhum concurso disponível.");
    }

    const ultimo = draws[0];

    const result = checkCombosAgainstDraw(filtered, ultimo.dezenas);

    setResultsChecked({
      concurso: ultimo.concurso,
      date: ultimo.date,
      combos: result,
    });

    setLoading(false);
  }

  /******************************************************************
   *  NÚMEROS PROVÁVEIS (MELHORADO)
   ******************************************************************/

  async function calcularProvaveis() {
    setLoading(true);

    let draws =
      apiDraws.length > 0
        ? apiDraws
        : await fetchDraws();

    if (!draws.length) {
      setLoading(false);
      return alert("Não foi possível carregar concursos.");
    }

    const freq = Array(61).fill(0);

    draws.forEach((d) =>
      d.dezenas.forEach((n) => freq[n]++)
    );

    const ranking = Array.from({ length: 60 }, (_, i) => i + 1)
      .sort((a, b) => freq[b] - freq[a]);

    setNumerosProvaveis(ranking.slice(0, 30));

    setLoading(false);
  }

  /******************************************************************
   *  DOWNLOAD
   ******************************************************************/

  function downloadJSON() {
    const data = {
      numbers,
      generatedAt: new Date().toISOString(),
      combos: filtered,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mega_desdobramento.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  /******************************************************************
   *  LIMPAR
   ******************************************************************/

  function clearStorage() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem("mega_draws_cache");
    setFiltered([]);
    setApiDraws([]);
  }

  const removedCount = desdobramento.length - filtered.length;


  /******************************************************************
   *  RENDERIZAÇÃO
   ******************************************************************/

  return (
    <div className="max-w-4xl mx-auto p-6 text-sm">
      <h1 className="text-2xl font-bold mb-4">Mega-Sena — Desdobramento Inteligente</h1>

      <form onSubmit={handleGenerate} className="space-y-3 mb-4">

        {/* INPUT */}
        <label className="block">
          <span className="font-medium">Números:</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ex: 5 12 23 34 45 56"
            className="mt-1 block w-full rounded border p-2"
          />
        </label>

        {/* BOTÕES */}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          >
            Gerar Desdobramento
          </button>

          <button
            type="button"
            onClick={fetchDraws}
            disabled={loading}
            className="px-4 py-2 bg-gray-300 rounded"
          >
            {fetchStatus === "ok" && "✔ Fetched"}
            {fetchStatus === "fail" && "❌ Tentar novamente"}
            {fetchStatus === "none" && "Atualizar concursos"}
          </button>

          <button
            type="button"
            onClick={calcularProvaveis}
            disabled={loading}
            className="px-4 py-2 bg-purple-600 text-white rounded"
          >
            Números Prováveis (30)
          </button>

          <button
            type="button"
            onClick={handleCheckResults}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 text-white rounded"
          >
            Checar Último Concurso
          </button>

          <button
            type="button"
            onClick={downloadJSON}
            className="px-4 py-2 bg-green-600 text-white rounded"
          >
            Baixar JSON
          </button>

          <button
            type="button"
            onClick={clearStorage}
            className="px-4 py-2 bg-red-500 text-white rounded"
          >
            Limpar
          </button>
        </div>
      </form>

      {/* DADOS DO USUÁRIO */}
      <div className="mb-4">
        <strong>Quantidade escolhida:</strong> {numbers.length} <br />
        <strong>Escolhidos:</strong> {numbers.join(", ")} <br />
        <strong>Total gerado:</strong> {desdobramento.length} <br />
        <strong>Filtrados:</strong> {filtered.length} <br />
        <strong>Removidos:</strong> {removedCount} <br />
      </div>

      {/* LISTA */}
      <h2 className="font-semibold">Primeiras 200 combinações filtradas</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
        {filtered.slice(0, 200).map((c, i) => (
          <div key={i} className="p-2 border rounded">
            {c.join(", ")}
          </div>
        ))}
      </div>

      {/* RESULTADO */}
      {resultsChecked.combos && (
        <div className="mt-6">
          <h3 className="font-semibold">
            Resultado — Concurso {resultsChecked.concurso}
          </h3>

          <ul className="list-disc pl-6">
            <li>6 acertos: {resultsChecked.combos.filter((c) => c.hits === 6).length}</li>
            <li>5 acertos: {resultsChecked.combos.filter((c) => c.hits === 5).length}</li>
            <li>4 acertos: {resultsChecked.combos.filter((c) => c.hits === 4).length}</li>
          </ul>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {resultsChecked.combos
              .filter((c) => c.hits >= 4)
              .map((c, i) => (
                <div key={i} className="p-2 border rounded">
                  {c.combo.join(", ")} — {c.hits} acertos
                </div>
              ))}
          </div>
        </div>
      )}

      {/* NÚMEROS PROVÁVEIS */}
      {numerosProvaveis.length > 0 && (
        <div className="mt-6 p-4 border rounded bg-purple-50">
          <h3 className="font-semibold mb-2">30 números mais prováveis</h3>
          <div className="grid grid-cols-6 gap-2">
            {numerosProvaveis.map((n, i) => (
              <div key={i} className="p-1 bg-white border rounded text-center">
                {n}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/******************************************************************
 *  MONTAGEM DO APP
 ******************************************************************/

const root = document.querySelector("#app_root");
createRoot(root).render(<MegaDesdobramentoApp />);

