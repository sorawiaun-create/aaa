// VoiceClone AI — frontend logic (no build step, vanilla JS).

const $ = (sel) => document.querySelector(sel);

const form = $("#form");
const fileInput = $("#sample");
const drop = $("#drop");
const dzIdle = drop.querySelector(".dz-idle");
const dzFile = drop.querySelector(".dz-file");
const dzName = drop.querySelector(".dz-name");
const dzSize = drop.querySelector(".dz-size");
const clearBtn = drop.querySelector(".clear");
const samplePreview = $("#samplePreview");

const textArea = $("#text");
const count = $("#count");
const langSelect = $("#language");

const submitBtn = $("#submit");
const spinner = submitBtn.querySelector(".spinner");
const btnLabel = submitBtn.querySelector(".label");
const statusBar = $("#status");

const result = $("#result");
const output = $("#output");
const download = $("#download");

let sampleObjectUrl = null;

// ---- Load supported languages ------------------------------------------------
async function loadLanguages() {
  try {
    const res = await fetch("/api/languages");
    const { languages } = await res.json();
    langSelect.innerHTML = "";
    for (const [code, name] of Object.entries(languages)) {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = name;
      langSelect.appendChild(opt);
    }
  } catch {
    langSelect.innerHTML = '<option value="en">English</option>';
  }
}
loadLanguages();

// ---- File handling -----------------------------------------------------------
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function showFile(file) {
  dzName.textContent = file.name;
  dzSize.textContent = humanSize(file.size);
  dzIdle.hidden = true;
  dzFile.hidden = false;

  if (sampleObjectUrl) URL.revokeObjectURL(sampleObjectUrl);
  sampleObjectUrl = URL.createObjectURL(file);
  samplePreview.src = sampleObjectUrl;
  samplePreview.hidden = false;
}

function clearFile() {
  fileInput.value = "";
  dzIdle.hidden = false;
  dzFile.hidden = true;
  samplePreview.hidden = true;
  if (sampleObjectUrl) {
    URL.revokeObjectURL(sampleObjectUrl);
    sampleObjectUrl = null;
  }
}

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) showFile(fileInput.files[0]);
});

clearBtn.addEventListener("click", (e) => {
  e.preventDefault();
  clearFile();
});

["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
  })
);
drop.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) {
    fileInput.files = e.dataTransfer.files;
    showFile(file);
  }
});

// ---- Character count ---------------------------------------------------------
const updateCount = () => {
  count.textContent = `${textArea.value.length} / 5000`;
};
textArea.addEventListener("input", updateCount);
updateCount();

// ---- Submit ------------------------------------------------------------------
function setBusy(busy, message) {
  submitBtn.disabled = busy;
  spinner.hidden = !busy;
  btnLabel.textContent = busy ? "กำลังสร้าง..." : "✨ สร้างเสียงพูด";
  if (message) {
    statusBar.hidden = false;
    statusBar.classList.remove("error");
    statusBar.textContent = message;
  }
}

function showError(message) {
  statusBar.hidden = false;
  statusBar.classList.add("error");
  statusBar.textContent = `⚠️ ${message}`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!fileInput.files[0]) {
    showError("กรุณาอัปโหลดเสียงตัวอย่างก่อน");
    return;
  }
  if (!textArea.value.trim()) {
    showError("กรุณาพิมพ์ข้อความ");
    return;
  }

  result.hidden = true;
  setBusy(true, "⏳ กำลังประมวลผล... ครั้งแรกอาจใช้เวลาสักครู่เพื่อโหลดโมเดล");

  const data = new FormData();
  data.append("sample", fileInput.files[0]);
  data.append("text", textArea.value.trim());
  data.append("language", langSelect.value);

  try {
    const res = await fetch("/api/generate", { method: "POST", body: data });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `เกิดข้อผิดพลาด (${res.status})`);
    }
    const { url, download_url } = await res.json();
    output.src = url;
    download.href = download_url;
    result.hidden = false;
    statusBar.hidden = true;
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (err) {
    showError(err.message);
  } finally {
    setBusy(false);
  }
});
