import { useState, useMemo, useCallback, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

const METODOS = [
  { id: 'spacy', label: 'spaCy' },
  { id: 'sumy', label: 'Sumy' },
  { id: 'tfidf', label: 'TF-IDF' },
]

const TAMANHOS = [
  { id: 'pequeno', label: 'Pequeno' },
  { id: 'medio', label: 'Médio' },
  { id: 'grande', label: 'Grande' },
]

function contarPalavras(texto) {
  const t = texto.trim()
  if (!t) return 0
  return t.split(/\s+/).length
}

// Divide o texto em frases de forma simples (heurística, não é NLP de verdade)
function dividirFrases(texto) {
  const bruto = texto.match(/[^.!?]+[.!?]+(\s+|$)|[^.!?]+$/g) || []
  return bruto.map((f) => f.trim()).filter(Boolean)
}

async function extrairTextoDoPDF(file) {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise

  const paginas = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const pagina = await pdf.getPage(i)
    const conteudo = await pagina.getTextContent()
    const textoPagina = conteudo.items.map((item) => item.str).join(' ')
    paginas.push(textoPagina)
  }

  // Junta as páginas e normaliza espaços/quebras de linha excessivas
  return paginas
    .join('\n\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function TextoMarcado({ original, resumo }) {
  const frases = useMemo(() => dividirFrases(original), [original])
  const resumoNormalizado = resumo.replace(/\s+/g, ' ').trim()

  return (
    <div className="marked-text">
      {frases.map((frase, i) => {
        const fraseLimpa = frase.replace(/\s+/g, ' ').trim()
        const mantida = fraseLimpa.length > 0 && resumoNormalizado.includes(fraseLimpa)
        return mantida ? (
          <mark key={i}>{frase} </mark>
        ) : (
          <span key={i}>{frase} </span>
        )
      })}
    </div>
  )
}

function App() {
  const [apiBase, setApiBase] = useState('http://127.0.0.1:8000')
  const [texto, setTexto] = useState('')
  const [metodo, setMetodo] = useState('sumy')
  const [tamanho, setTamanho] = useState('medio')
  const [status, setStatus] = useState('idle') // idle | loading | success | error
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState(null)
  const [copiado, setCopiado] = useState(false)
  const [pdfStatus, setPdfStatus] = useState('idle') // idle | loading | error
  const [pdfErro, setPdfErro] = useState('')
  const [pdfNome, setPdfNome] = useState('')
  const inputPdfRef = useRef(null)

  const palavrasOriginal = useMemo(() => contarPalavras(texto), [texto])

  const lidarComPDF = useCallback(async (e) => {
    const arquivo = e.target.files?.[0]
    if (!arquivo) return

    if (arquivo.type !== 'application/pdf') {
      setPdfStatus('error')
      setPdfErro('Esse arquivo não é um PDF.')
      return
    }

    setPdfStatus('loading')
    setPdfErro('')
    setResultado(null)
    setStatus('idle')

    try {
      const textoExtraido = await extrairTextoDoPDF(arquivo)
      if (!textoExtraido) {
        throw new Error('Não encontrei texto nesse PDF (ele pode ser um PDF escaneado/imagem).')
      }
      setTexto(textoExtraido)
      setPdfNome(arquivo.name)
      setPdfStatus('idle')
    } catch (err) {
      setPdfStatus('error')
      setPdfErro(err.message || 'Não foi possível ler esse PDF.')
    } finally {
      e.target.value = '' // permite reenviar o mesmo arquivo depois, se quiser
    }
  }, [])

  const gerarResumo = useCallback(async () => {
    if (!texto.trim()) return
    setStatus('loading')
    setErro('')
    setCopiado(false)

    try {
      const resp = await fetch(`${apiBase.replace(/\/$/, '')}/summarize/${metodo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          texto: texto,
          idioma: 'portuguese',
          tamanho: tamanho,
        }),
      })

      if (!resp.ok) {
        let detalhe = `Erro ${resp.status}`
        try {
          const corpo = await resp.json()
          if (corpo && corpo.detail) detalhe = corpo.detail
        } catch (e) {
          // corpo sem JSON válido, mantém a mensagem genérica
        }
        throw new Error(detalhe)
      }

      const dados = await resp.json()
      setResultado(dados)
      setStatus('success')
    } catch (e) {
      setErro(
        e.message === 'Failed to fetch'
          ? 'Não foi possível falar com a API. Confira se ela está rodando e se o endereço acima está correto.'
          : e.message
      )
      setStatus('error')
    }
  }, [texto, metodo, tamanho, apiBase])

  const copiarResumo = useCallback(() => {
    if (!resultado) return
    navigator.clipboard.writeText(resultado.resumo).then(() => {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    })
  }, [resultado])

  const reducaoPct = resultado
    ? Math.round(100 - (resultado.tamanho_resumo / resultado.tamanho_original) * 100)
    : 0

  return (
    <div className="wrap">

      <div className="masthead">
        <div className="eyebrow">três motores · um resumo</div>
        <h1 className="title">Sumar<em>IzA</em></h1>
        <p className="subtitle">
          Cole um texto, escolha o método de extração e o tamanho do resumo.
          As frases mantidas aparecem grifadas no texto original, para você
          ver exatamente o que a máquina escolheu.
        </p>
      </div>

      <div className="config-card">
        <div className="config-row">
          <div className="field api-field">
            <label htmlFor="api-url">Endereço da API</label>
            <input
              id="api-url"
              type="text"
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="http://127.0.0.1:8000"
            />
          </div>

          <div className="field">
            <label>Método</label>
            <div className="segmented" role="group" aria-label="Método de sumarização">
              {METODOS.map((m) => (
                <button
                  key={m.id}
                  className={metodo === m.id ? 'active' : ''}
                  onClick={() => setMetodo(m.id)}
                  type="button"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Tamanho</label>
            <div className="segmented" role="group" aria-label="Tamanho do resumo">
              {TAMANHOS.map((t) => (
                <button
                  key={t.id}
                  className={tamanho === t.id ? 'active' : ''}
                  onClick={() => setTamanho(t.id)}
                  type="button"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="desk">

        <div className="pane">
          <div className="pane-head">
            <h2>Texto original</h2>
            <span className="count">{palavrasOriginal} palavras</span>
          </div>

          <input
            ref={inputPdfRef}
            type="file"
            accept="application/pdf"
            onChange={lidarComPDF}
            style={{ display: 'none' }}
          />

          {pdfNome && pdfStatus !== 'error' && (
            <div className="pdf-badge">
              <span>📄 {pdfNome}</span>
              <button type="button" onClick={() => setPdfNome('')} aria-label="Remover referência ao PDF">✕</button>
            </div>
          )}

          {pdfStatus === 'error' && (
            <div className="pdf-badge pdf-badge-error">
              <span>{pdfErro}</span>
              <button type="button" onClick={() => setPdfStatus('idle')} aria-label="Fechar aviso">✕</button>
            </div>
          )}

          <textarea
            value={texto}
            onChange={(e) => { setTexto(e.target.value); setPdfNome('') }}
            placeholder={pdfStatus === 'loading' ? 'Lendo o PDF…' : 'Cole aqui o texto que você quer resumir, ou carregue um PDF...'}
            disabled={pdfStatus === 'loading'}
          />
          <div className="actions">
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => { setTexto(''); setResultado(null); setStatus('idle'); setPdfNome('') }}
              >
                Limpar
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => inputPdfRef.current?.click()}
                disabled={pdfStatus === 'loading'}
              >
                {pdfStatus === 'loading' ? 'Lendo PDF…' : 'Carregar PDF'}
              </button>
            </div>
            <button
              className="btn-primary"
              type="button"
              disabled={!texto.trim() || status === 'loading' || pdfStatus === 'loading'}
              onClick={gerarResumo}
            >
              {status === 'loading' ? 'Resumindo…' : 'Gerar resumo'}
            </button>
          </div>
        </div>

        <div className="pane">
          <div className="pane-head">
            <h2>Resumo</h2>
            {resultado && (
              <span className="count">{resultado.tamanho_resumo} caracteres</span>
            )}
          </div>

          {status === 'idle' && (
            <div className="empty-state">
              <span className="glyph">" "</span>
              <p>O resumo aparece aqui assim que você gerar.</p>
            </div>
          )}

          {status === 'loading' && (
            <div className="loading-state">
              <div className="spinner"></div>
              <p style={{ margin: 0, fontSize: 13.5 }}>Consultando o método escolhido…</p>
            </div>
          )}

          {status === 'error' && (
            <div className="error-box">
              <strong>Não deu para gerar o resumo</strong>
              <span>{erro}</span>
            </div>
          )}

          {status === 'success' && resultado && (
            <div className="result-wrap">

              <div className="meter">
                <div className="meter-labels">
                  <span>{resultado.tamanho_original} car. originais</span>
                  <b>-{reducaoPct}%</b>
                  <span>{resultado.tamanho_resumo} car. no resumo</span>
                </div>
                <div className="meter-track">
                  <div
                    className="meter-fill"
                    style={{ width: `${100 - reducaoPct}%` }}
                  ></div>
                </div>
              </div>

              <div className="summary-card">
                <span className="tag">método: {resultado.metodo} · tamanho: {resultado.tamanho}</span>
                {resultado.resumo}
              </div>

              <div className="copy-row">
                <button className="btn-ghost" type="button" onClick={copiarResumo}>
                  {copiado ? 'Copiado ✓' : 'Copiar resumo'}
                </button>
              </div>

              <TextoMarcado original={texto} resumo={resultado.resumo} />
            </div>
          )}
        </div>

      </div>

      <footer>SumarIzA · front-end React consumindo a API FastAPI de sumarização</footer>
    </div>
  )
}

export default App