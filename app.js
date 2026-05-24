const languages = [
  { code: "auto", name: "자동 감지" },
  { code: "ko", name: "한국어" },
  { code: "en", name: "영어" },
  { code: "ja", name: "일본어" },
  { code: "zh-CN", name: "중국어 간체" },
  { code: "zh-TW", name: "중국어 번체" },
  { code: "es", name: "스페인어" },
  { code: "fr", name: "프랑스어" },
  { code: "de", name: "독일어" },
  { code: "it", name: "이탈리아어" },
  { code: "pt", name: "포르투갈어" },
  { code: "ru", name: "러시아어" },
  { code: "vi", name: "베트남어" },
  { code: "id", name: "인도네시아어" },
  { code: "th", name: "태국어" },
  { code: "ar", name: "아랍어" },
];

const historyKey = "trans-history-v1";
const maxChars = 12000;
const maxHistory = 12;

const sourceLanguage = document.querySelector("#sourceLanguage");
const targetLanguage = document.querySelector("#targetLanguage");
const sourceText = document.querySelector("#sourceText");
const resultText = document.querySelector("#resultText");
const sourceCounter = document.querySelector("#sourceCounter");
const resultCounter = document.querySelector("#resultCounter");
const translateButton = document.querySelector("#translateButton");
const copyButton = document.querySelector("#copyButton");
const saveButton = document.querySelector("#saveButton");
const swapButton = document.querySelector("#swapButton");
const clearAllButton = document.querySelector("#clearAllButton");
const clearHistoryButton = document.querySelector("#clearHistoryButton");
const historyList = document.querySelector("#historyList");
const statusText = document.querySelector("#statusText");
const installButton = document.querySelector("#installButton");

let deferredInstallPrompt = null;
let activeController = null;

function init() {
  fillLanguageSelects();
  sourceLanguage.value = "auto";
  targetLanguage.value = "en";
  bindEvents();
  updateCounters();
  renderHistory();
  registerServiceWorker();
}

function fillLanguageSelects() {
  sourceLanguage.innerHTML = "";
  targetLanguage.innerHTML = "";

  languages.forEach((language) => {
    sourceLanguage.appendChild(createOption(language));
    if (language.code !== "auto") {
      targetLanguage.appendChild(createOption(language));
    }
  });
}

function createOption(language) {
  const option = document.createElement("option");
  option.value = language.code;
  option.textContent = language.name;
  return option;
}

function bindEvents() {
  sourceText.addEventListener("input", updateCounters);
  resultText.addEventListener("input", updateCounters);
  translateButton.addEventListener("click", translateCurrentText);
  copyButton.addEventListener("click", copyResult);
  saveButton.addEventListener("click", () => saveTranslation(getCurrentRecord()));
  swapButton.addEventListener("click", swapLanguages);
  clearAllButton.addEventListener("click", clearEditor);
  clearHistoryButton.addEventListener("click", clearHistory);

  sourceText.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      translateCurrentText();
    }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });
}

function updateCounters() {
  sourceCounter.textContent = `${sourceText.value.length} / ${maxChars}`;
  resultCounter.textContent = `${resultText.value.length}`;
  copyButton.disabled = resultText.value.trim().length === 0;
  saveButton.disabled = resultText.value.trim().length === 0;
}

async function translateCurrentText() {
  const input = sourceText.value.trim();
  const source = sourceLanguage.value;
  const target = targetLanguage.value;

  if (!input) {
    setStatus("번역할 텍스트를 입력하세요", "error");
    sourceText.focus();
    return;
  }

  if (source !== "auto" && source === target) {
    resultText.value = input;
    updateCounters();
    setStatus("같은 언어라 원문을 그대로 복사했습니다", "done");
    addHistory(getCurrentRecord());
    return;
  }

  if (activeController) {
    activeController.abort();
  }

  activeController = new AbortController();
  translateButton.disabled = true;
  translateButton.textContent = "번역 중";
  setStatus("온라인 번역 중", "working");

  try {
    const output = await translateText(input, source, target, activeController.signal);
    resultText.value = output;
    updateCounters();
    setStatus("번역 완료", "done");
    addHistory(getCurrentRecord());
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("이전 번역을 중단했습니다", "error");
    } else {
      setStatus(error.message || "번역에 실패했습니다", "error");
    }
  } finally {
    translateButton.disabled = false;
    translateButton.textContent = "번역하기";
    activeController = null;
  }
}

async function translateText(text, source, target, signal) {
  const chunks = splitText(text, 1100);
  const translatedChunks = [];

  for (const chunk of chunks) {
    try {
      translatedChunks.push(await translateWithGoogleEndpoint(chunk, source, target, signal));
    } catch (firstError) {
      if (source === "auto") {
        throw new Error("자동 감지 번역에 실패했습니다. 원문 언어를 직접 선택해 보세요.");
      }
      translatedChunks.push(await translateWithMyMemory(chunk, source, target, signal, firstError));
    }
  }

  return translatedChunks.join("\n").trim();
}

function splitText(text, size) {
  if (text.length <= size) {
    return [text];
  }

  const chunks = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = "";

  paragraphs.forEach((paragraph) => {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= size) {
      current = next;
      return;
    }
    if (current) {
      chunks.push(current);
      current = "";
    }
    chunks.push(...splitLongParagraph(paragraph, size));
  });

  if (current) {
    chunks.push(current);
  }

  return chunks.filter(Boolean);
}

function splitLongParagraph(paragraph, size) {
  const chunks = [];
  let current = "";
  const parts = paragraph.match(/[^.!?。！？]+[.!?。！？]?\s*/g) || [paragraph];

  parts.forEach((part) => {
    if ((current + part).length <= size) {
      current += part;
      return;
    }
    if (current) {
      chunks.push(current.trim());
      current = "";
    }
    for (let index = 0; index < part.length; index += size) {
      chunks.push(part.slice(index, index + size).trim());
    }
  });

  if (current) {
    chunks.push(current.trim());
  }

  return chunks;
}

async function translateWithGoogleEndpoint(text, source, target, signal) {
  const params = new URLSearchParams({
    client: "gtx",
    sl: source,
    tl: target,
    dt: "t",
    q: text,
  });
  const response = await fetch(
    `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
    { signal },
  );

  if (!response.ok) {
    throw new Error("기본 번역 서버가 응답하지 않습니다");
  }

  const data = await response.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error("번역 응답을 읽을 수 없습니다");
  }

  return data[0]
    .map((segment) => segment?.[0] || "")
    .join("")
    .trim();
}

async function translateWithMyMemory(text, source, target, signal, previousError) {
  const params = new URLSearchParams({
    q: text,
    langpair: `${source}|${target}`,
  });
  const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`, {
    signal,
  });

  if (!response.ok) {
    throw previousError || new Error("대체 번역 서버가 응답하지 않습니다");
  }

  const data = await response.json();
  if (data.responseStatus >= 400 || !data.responseData?.translatedText) {
    throw previousError || new Error(data.responseDetails || "번역에 실패했습니다");
  }

  return decodeHtml(data.responseData.translatedText).trim();
}

function decodeHtml(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

async function copyResult() {
  if (!resultText.value.trim()) {
    return;
  }

  try {
    await navigator.clipboard.writeText(resultText.value);
    setStatus("결과를 복사했습니다", "done");
  } catch {
    resultText.select();
    document.execCommand("copy");
    setStatus("결과를 복사했습니다", "done");
  }
}

function saveTranslation(record) {
  if (!record.output.trim()) {
    return;
  }

  const body = [
    "Trans 번역 결과",
    `생성: ${new Date(record.createdAt).toLocaleString()}`,
    `언어: ${getLanguageName(record.source)} → ${getLanguageName(record.target)}`,
    "",
    "[원문]",
    record.input,
    "",
    "[번역]",
    record.output,
    "",
  ].join("\n");

  const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildFileName(record);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 100);
  setStatus("TXT 파일을 저장했습니다", "done");
}

function buildFileName(record) {
  const stamp = new Date(record.createdAt)
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  return `trans-${record.source}-to-${record.target}-${stamp}.txt`;
}

function getCurrentRecord() {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    source: sourceLanguage.value,
    target: targetLanguage.value,
    input: sourceText.value.trim(),
    output: resultText.value.trim(),
    createdAt: new Date().toISOString(),
  };
}

function addHistory(record) {
  if (!record.input || !record.output) {
    return;
  }

  const history = loadHistory();
  history.unshift(record);
  saveHistory(history.slice(0, maxHistory));
  renderHistory();
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(historyKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  localStorage.setItem(historyKey, JSON.stringify(history));
}

function renderHistory() {
  const history = loadHistory();
  historyList.innerHTML = "";

  if (!history.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "저장된 번역이 없습니다";
    historyList.appendChild(empty);
    return;
  }

  history.forEach((record) => {
    const item = document.createElement("article");
    item.className = "history-item";

    const meta = document.createElement("div");
    meta.className = "history-meta";
    const languagePair = document.createElement("span");
    languagePair.textContent = `${getLanguageName(record.source)} → ${getLanguageName(record.target)}`;
    const createdAt = document.createElement("span");
    createdAt.textContent = formatTime(record.createdAt);
    meta.append(languagePair, createdAt);

    const preview = document.createElement("p");
    preview.className = "history-preview";
    preview.textContent = record.output;

    const actions = document.createElement("div");
    actions.className = "history-actions";
    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.textContent = "불러오기";
    loadButton.addEventListener("click", () => loadRecord(record));

    const saveButtonElement = document.createElement("button");
    saveButtonElement.type = "button";
    saveButtonElement.textContent = "TXT";
    saveButtonElement.addEventListener("click", () => saveTranslation(record));

    actions.append(loadButton, saveButtonElement);
    item.append(meta, preview, actions);
    historyList.appendChild(item);
  });
}

function loadRecord(record) {
  sourceLanguage.value = record.source;
  targetLanguage.value = record.target;
  sourceText.value = record.input;
  resultText.value = record.output;
  updateCounters();
  setStatus("기록을 불러왔습니다", "done");
}

function clearHistory() {
  localStorage.removeItem(historyKey);
  renderHistory();
  setStatus("최근 기록을 비웠습니다", "done");
}

function clearEditor() {
  sourceText.value = "";
  resultText.value = "";
  updateCounters();
  setStatus("대기 중", "");
  sourceText.focus();
}

function swapLanguages() {
  if (sourceLanguage.value === "auto") {
    setStatus("자동 감지 상태에서는 언어를 바꿀 수 없습니다", "error");
    return;
  }

  const previousSource = sourceLanguage.value;
  sourceLanguage.value = targetLanguage.value;
  targetLanguage.value = previousSource;

  if (resultText.value.trim()) {
    const previousInput = sourceText.value;
    sourceText.value = resultText.value;
    resultText.value = previousInput;
    updateCounters();
  }
}

function getLanguageName(code) {
  return languages.find((language) => language.code === code)?.name || code;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function setStatus(message, state) {
  statusText.textContent = message;
  statusText.dataset.state = state || "";
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }
}

init();
