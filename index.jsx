import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

/* =========================
   Helpers (combinações e filtros)
   ========================= */
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

/* =========================
   API config (Guidi)
   ========================= */
const BASE_CONCURSO = "https://api.guidi.dev.br/loteria/megasena";
const URL_ULTIMO = `${BASE_CONCURSO}/ultimo`;

/* =========================
   App Component
   ========================= */
export default function MegaDesdobramentoApp() {
  // inputs / states
  const [input, setInput] = useState("");
  const [numbers, setNumbers] = useState([]); // user selected numbers (1..60)
  const [desdobramento, setDesdobramento] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [apiDraws, setApiDraws] = useState([]); // cached draws from API
  const [fetchStatus, setFetchStatus] = useState("none"); // none | ok | fail | loading
  const [loading, setLoading] = useState(false);
  const [resultsChecked, setResultsChecked] = useState(null);
  const [numerosProvaveis, setNumerosProvaveis] = useState([]);
  const [provaveisCount, setProvaveisCount] = useState(30); // configurable by user
  const [copied, setCopied] = useState(false);

  // mostrar/ocultar blocos
  const [showProvaveis, setShowProvaveis] = useState(false); // provaveis hidden by default
  const [filteredHidden, setFilteredHidden] = useState(true); // combos hidden by default

  // paginacao das combinações (50 em 50)
  const COMBOS_PER_PAGE = 50;
  const [showPage, setShowPage] = useState(null); // null = nenhuma página mostrada, 0-based index

  const STORAGE_KEY = "mega_desdobramento_games";
  const DRAWS_CACHE_KEY = "mega_draws_cache";
  const HISTORY_KEY = "mega_desdobramento_history";

  useEffect(() => {
    // load cached combos (last generated)
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        setFiltered(JSON.parse(raw));
      } catch (e) {
        console.warn("localStorage parse error", e);
      }
    }
    // load cached draws if exist
    const cached = localStorage.getItem(DRAWS_CACHE_KEY);
    if (cached) {
      try {
        setApiDraws(JSON.parse(cached));
        setFetchStatus("ok");
      } catch {}
    }
  }, []);

  /* -------------------------
     When user types/pastes into input, update selection immediately
     - parse numbers and setNumbers
     - keep input as-is (so user can continue editing)
     ------------------------- */
  useEffect(() => {
    const parts = String(input)
      .split(/[ ,;]+/)
      .map((t) => Number(t.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 60);
    const unique = Array.from(new Set(parts)).slice(0, 20).sort((a, b) => a - b);
    setNumbers(unique);
  }, [input]);

  /* -------------------------
     API: fetchDraws (robusto)
     ------------------------- */
  async function fetchDraws() {
    setLoading(true);
    setFetchStatus("loading");
    let ultimo = null;
    try {
      const resUltimo = await fetch(URL_ULTIMO, { cache: "no-store" });
      if (resUltimo.ok) {
        const d = await resUltimo.json();
        ultimo = d.numero ?? d.concurso ?? d.numeroDoConcurso ?? null;
      }
    } catch (e) {
      // fallback handled below
    }
    if (!ultimo) {
      setFetchStatus("fail");
      setLoading(false);
      return [];
    }

    // buscamos até 50 concursos (ou menos se não existirem)
    const maxBack = 50;
    const draws = [];
    for (let n = ultimo; n > ultimo - maxBack; n--) {
      try {
        const r = await fetch(`${BASE_CONCURSO}/${n}`, { cache: "no-store" });
        if (!r.ok) continue;
        const data = await r.json();
        const rawDezenas =
          data.dezenasSorteadasOrdemSorteio ||
          data.dezenas ||
          data.listaDezenas ||
          data.numeros ||
          data.resultado;
        let arr = [];
        if (Array.isArray(rawDezenas)) arr = rawDezenas.map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 60);
        else if (typeof rawDezenas === "string") arr = rawDezenas.split(/[^0-9]+/).filter(Boolean).map(Number);
        if (arr.length >= 6) {
          draws.push({
            concurso: data.numero ?? data.concurso ?? n,
            date: data.dataApuracao ?? data.data ?? null,
            dezenas: arr,
          });
        }
      } catch (e) {
        continue;
      }
    }

    if (!draws.length) {
      setFetchStatus("fail");
      setLoading(false);
      return [];
    }

    draws.sort((a, b) => b.concurso - a.concurso);
    setApiDraws(draws);
    localStorage.setItem(DRAWS_CACHE_KEY, JSON.stringify(draws));
    setFetchStatus("ok");
    setLoading(false);
    return draws;
  }

  /* -------------------------
     gerar desdobramento e aplicar filtros
     ------------------------- */
  function gerarDesdobramentoFromNumbers(nums) {
    if (!Array.isArray(nums)) nums = [];
    const uniq = Array.from(new Set(nums)).sort((a, b) => a - b);
    if (uniq.length < 6) return [];
    const combs = combinations(uniq, 6);
    setDesdobramento(combs);
    setFilteredHidden(true);
    setShowPage(null);
    return combs;
  }

  function aplicarFiltros(combs, drawsNormalized = []) {
    const pastSet = new Set((drawsNormalized || []).map((d) => comboKey(d.dezenas.slice(0, 6))));
    const out = [];
    for (const c of combs) {
      const key = comboKey(c);
      if (pastSet.has(key)) continue;
      if (isSimpleSequence(c)) continue;
      if (isConsecutive(c, 3)) continue;
      if (allBelowOrEqual(c, 31)) continue;
      if (allEven(c) || allOdd(c)) continue;
      out.push(c);
    }
    return out;
  }

  async function handleGenerate(e) {
    e && e.preventDefault();
    setCopied(false);

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
      alert("Máximo 20 números permitidos.");
      return;
    }

    setNumbers(unique);
    setLoading(true);

    const combs = gerarDesdobramentoFromNumbers(unique);

    // garante draws: se já tiver cache usa, se não tenta buscar
    const draws = apiDraws.length ? apiDraws : await fetchDraws();

    const final = aplicarFiltros(combs, draws);
    setFiltered(final);

    // salvar histórico e atual
    const entry = {
      inputNumbers: unique,
      totalCombinacoes: combs.length,
      totalFiltradas: final.length,
      totalRemovidas: combs.length - final.length,
      geradoEm: new Date().toISOString(),
    };
    const prev = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    prev.push(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(prev));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(final));

    // reset page visibility
    setFilteredHidden(true);
    setShowPage(null);

    setLoading(false);
  }

  /* -------------------------
     checar resultados (último concurso)
     ------------------------- */
  function checkCombosAgainstDraw(combos, drawDezenas) {
    const setD = new Set(drawDezenas);
    return combos.map((c) => {
      const hits = c.reduce((acc, n) => acc + (setD.has(n) ? 1 : 0), 0);
      return { combo: c.slice().sort((a, b) => a - b), hits };
    });
  }

  async function handleCheckResults() {
    if (!filtered || !filtered.length) return alert("Não há combinações geradas para checar.");
    setLoading(true);
    const draws = apiDraws.length ? apiDraws : await fetchDraws();
    if (!draws.length) {
      setLoading(false);
      return alert("Nenhum concurso disponível para checagem.");
    }
    const latest = draws[0];
    const check = checkCombosAgainstDraw(filtered, latest.dezenas);
    setResultsChecked({ concurso: latest.concurso, date: latest.date, combos: check });
    setLoading(false);
  }

  /* -------------------------
     calcular provaveis (quantidade configurável)
     ------------------------- */
  async function calcularProvaveis() {
    setCopied(false);
    setLoading(true);
    const draws = apiDraws.length ? apiDraws : await fetchDraws();
    if (!draws.length) {
      setLoading(false);
      return alert("Nenhum dado histórico disponível. Execute 'Atualizar concursos' ou busque um range.");
    }
    const freq = Array(61).fill(0);
    draws.forEach((d) => {
      (d.dezenas || []).forEach((n) => {
        if (Number.isInteger(n) && n >= 1 && n <= 60) freq[n]++;
      });
    });
    // ranking
    const ranking = Array.from({ length: 60 }, (_, i) => i + 1).sort((a, b) => freq[b] - freq[a] || a - b);
    const top = Math.max(1, Math.min(60, Number(provaveisCount) || 30));
    setNumerosProvaveis(ranking.slice(0, top));
    setLoading(false);
  }

  /* -------------------------
     Copy helper for provaveis
     ------------------------- */
  async function copyProvaveisAsCSV() {
    const txt = numerosProvaveis.join(", ");
    try {
      await navigator.clipboard.writeText(txt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      alert("Não foi possível copiar automaticamente. Selecione e copie manualmente: " + txt);
    }
  }

  /* -------------------------
     UI: volante interativo
     ------------------------- */
  function toggleNumber(n) {
    setCopied(false);
    setInput((prev) => prev); // keep input text (numbers sync via effect)
    setNumbers((prev) => {
      const exists = prev.includes(n);
      if (exists) return prev.filter((x) => x !== n);
      const next = [...prev, n].sort((a, b) => a - b);
      if (next.length > 20) return prev;
      return next;
    });
  }

  // sync numbers -> input (string) only when numbers change programmatically and input is not focused
  useEffect(() => {
    if (numbers && numbers.length) {
      if (!document.activeElement || document.activeElement.tagName !== "INPUT") {
        setInput(numbers.join(" "));
      }
    } else {
      if (!document.activeElement || document.activeElement.tagName !== "INPUT") {
        setInput("");
      }
    }
  }, [numbers]);

  /* -------------------------
     pagination helpers for filtered combos
     ------------------------- */
  const totalPages = Math.ceil(filtered.length / COMBOS_PER_PAGE);
  function getPageCombos(pageIndex) {
    if (!filtered || !filtered.length) return [];
    const start = pageIndex * COMBOS_PER_PAGE;
    return filtered.slice(start, start + COMBOS_PER_PAGE);
  }

  /* -------------------------
     small helpers & computed
     ------------------------- */
  const removedCount = desdobramento.length - filtered.length;

  /* -------------------------
     JSX Render
     ------------------------- */
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Mega-Sena — Desdobramento Inteligente</h1>

      <p className="mb-3 text-sm text-gray-700">
        Selecione números no volante (clique) ou digite/cole no campo — ao digitar o volante será atualizado automaticamente.
      </p>

      <form onSubmit={handleGenerate} className="space-y-3 mb-6">
        <label className="block">
          <span className="text-sm font-medium">Números (digite ou use o volante)</span>
          <input
            value={input}
            onChange={(e) => {
              setCopied(false);
              setInput(e.target.value);
            }}
            placeholder="ex: 5 12 23 34 45 56"
            className="mt-1 block w-full rounded border p-2"
          />
        </label>

        {/* volante */}
        <div className="grid grid-cols-10 gap-1 mb-2">
          {Array.from({ length: 60 }, (_, i) => i + 1).map((n) => {
            const active = numbers.includes(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => toggleNumber(n)}
                className={`p-2 text-xs rounded ${active ? "bg-blue-600 text-white" : "bg-white text-gray-800 border"} hover:scale-105 transition`}
              >
                {n}
              </button>
            );
          })}
        </div>

        {/* ações e opções */}
        <div className="flex flex-wrap gap-2 items-center">
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Gerar Desdobramento
          </button>

          <button
            type="button"
            onClick={fetchDraws}
            disabled={loading}
            className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
          >
            {fetchStatus === "ok" ? "✔ Concursos carregados" : fetchStatus === "loading" ? "Buscando..." : "Atualizar concursos"}
          </button>

          <button
            type="button"
            onClick={calcularProvaveis}
            disabled={loading}
            className="px-4 py-2 bg-purple-600 text-white rounded disabled:opacity-50"
          >
            {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : "Gerar Números Prováveis"}
          </button>

          <div className="flex items-center gap-2">
            <label className="text-sm">Qtd. prováveis:</label>
            <input
              type="number"
              min="1"
              max="60"
              value={provaveisCount}
              onChange={(e) => setProvaveisCount(Number(e.target.value))}
              className="w-20 rounded border p-1 text-sm"
            />
          </div>

          <button
            type="button"
            onClick={handleCheckResults}
            disabled={loading}
            className="px-3 py-2 bg-indigo-600 text-white rounded disabled:opacity-50"
          >
            Checar Último Concurso
          </button>

          <button type="button" onClick={() => {
            const data = { numbers, generatedAt: new Date().toISOString(), combos: filtered };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "mega_desdobramento.json";
            a.click();
            URL.revokeObjectURL(url);
          }} className="px-3 py-2 bg-green-600 text-white rounded">
            Baixar JSON
          </button>

          <button type="button" onClick={() => {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(DRAWS_CACHE_KEY);
            localStorage.removeItem(HISTORY_KEY);
            setFiltered([]);
            setApiDraws([]);
            setDesdobramento([]);
            setNumbers([]);
            setInput("");
            setNumerosProvaveis([]);
            setResultsChecked(null);
            setFetchStatus("none");
            setShowPage(null);
            setFilteredHidden(true);
            setShowProvaveis(true);
          }} className="px-3 py-2 bg-red-500 text-white rounded">
            Limpar Tudo
          </button>
        </div>
      </form>

      {/* indicadores */}
      <div className="mb-4 text-sm">
        <strong>Escolhidos:</strong> {numbers.join(", ") || "—"} <br />
        <strong>Total gerado:</strong> {desdobramento.length} &nbsp;|&nbsp; <strong>Filtrados:</strong> {filtered.length} &nbsp;|&nbsp; <strong>Removidos:</strong> {removedCount}
      </div>

          {/* botão para mostrar/ocultar números prováveis (aparece logo abaixo do resultado verificado) */}
          <div className="mt-3">
            <button
              onClick={() => setShowProvaveis((s) => !s)}
              className="px-3 py-2 bg-purple-600 text-white rounded"
            >
              {showProvaveis ? "Ocultar Números Prováveis" : `Mostrar Números Prováveis (${numerosProvaveis.length || 0})`}
            </button>
          </div>

      {/* RESULTADO DA CHECAGEM - aparece logo antes das combinações */}
      {resultsChecked && resultsChecked.combos && (
        <div className="mb-6 p-3 border rounded bg-gray-50">
          <h3 className="font-semibold">Resultado verificado — Concurso {resultsChecked.concurso}</h3>
          <div className="text-sm text-gray-700">Data: {resultsChecked.date || "—"}</div>
          <div className="mt-2">
            <ul className="list-disc pl-6">
              <li>6 acertos: {resultsChecked.combos.filter((c) => c.hits === 6).length}</li>
              <li>5 acertos: {resultsChecked.combos.filter((c) => c.hits === 5).length}</li>
              <li>4 acertos: {resultsChecked.combos.filter((c) => c.hits === 4).length}</li>
            </ul>
          </div>

          {/* combinações com 4+ acertos — cores diferentes */}
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {resultsChecked.combos
              .filter((c) => c.hits >= 4)
              .map((c, i) => {
                const bg =
                  c.hits === 6 ? "bg-yellow-100" : c.hits === 5 ? "bg-green-100" : "bg-blue-100";
                return (
                  <div key={i} className={`${bg} p-2 border rounded`}>
                    {c.combo.join(", ")} — <strong>{c.hits}</strong> acertos
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* NÚMEROS PROVÁVEIS (AGORA AQUI, OCULTOS POR PADRÃO) */}
      {showProvaveis && numerosProvaveis && numerosProvaveis.length > 0 && (
        <div className="mb-6 p-3 border rounded bg-purple-50">
          <h3 className="font-semibold">Números Prováveis ({numerosProvaveis.length})</h3>
          <div className="mt-2 mb-2 grid grid-cols-6 gap-2">
            {numerosProvaveis.map((n, i) => (
              <div key={i} className="p-2 bg-white border rounded text-center">{n}</div>
            ))}
          </div>

          <div className="flex gap-2 items-center mt-2">
            <div className="text-sm">Lista:</div>
            <div className="flex-1 p-2 border rounded bg-gray-50 text-sm">{numerosProvaveis.join(", ")}</div>
            <button onClick={copyProvaveisAsCSV} className="px-3 py-2 bg-blue-600 text-white rounded">
              {copied ? "Copiado!" : "Copiar lista"}
            </button>
          </div>
        </div>
      )}

      {/* amostra de combos - ocultas por padrão e paginadas 50x */}
      <div className="mb-6">
        <h3 className="font-semibold mb-2">Combinações filtradas (ocultas por padrão)</h3>

        {filtered.length === 0 ? (
          <div className="text-sm text-gray-600">Nenhuma combinação gerada ainda.</div>
        ) : (
          <>
            <div className="flex gap-2 items-center mb-3">
              <div className="text-sm">Mostrar combinações por página (50):</div>
              <div className="flex gap-1 flex-wrap">
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setShowPage(i);
                      setFilteredHidden(false);
                      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                    }}
                    className={`px-2 py-1 text-sm rounded border ${showPage === i ? "bg-blue-600 text-white" : "bg-white"}`}
                  >
                    Página {i + 1}
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  if (filteredHidden) {
                    setShowPage(0);
                    setFilteredHidden(false);
                  } else {
                    setShowPage(null);
                    setFilteredHidden(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                }}
                className="ml-3 px-3 py-1 rounded bg-gray-200 text-sm"
              >
                {filteredHidden ? "Mostrar (primeira página)" : "Ocultar combinações"}
              </button>
            </div>

            {!filteredHidden && showPage !== null && (
              <div>
                <div className="text-xs text-gray-600 mb-2">Exibindo página {showPage + 1} de {totalPages} — combinações {showPage * COMBOS_PER_PAGE + 1} a {Math.min(filtered.length, (showPage + 1) * COMBOS_PER_PAGE)}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {getPageCombos(showPage).map((c, i) => (
                    <div key={i} className="p-2 border rounded text-sm">{c.join(", ")}</div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="text-xs text-gray-500 mt-6">
        Nota: o app usa a API Guidi (https://api.guidi.dev.br/loteria/megasena). Em alguns navegadores a chamada direta
        pode ser bloqueada por CORS; se isso ocorrer, rode um proxy simples que repasse as requisições.
      </div>
    </div>
  );
}

/* =========================
   Render do App
   ========================= */
const appRoot = document.querySelector("#app_root");
if (!appRoot) {
  console.error("Elemento #app_root não encontrado — crie um <div id='app_root'></div> no HTML");
} else {
  createRoot(appRoot).render(<MegaDesdobramentoApp />);
}

