import { api, setSession, clearSession, getToken } from "./api.js";

const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const authForm = document.querySelector("#auth-form");
const authError = document.querySelector("#auth-error");
const authSubmit = document.querySelector("#auth-submit");
const listEl = document.querySelector("#list");
const tagsEl = document.querySelector("#tags");
const form = document.querySelector("#contact-form");
const formError = document.querySelector("#form-error");
const cancelBtn = document.querySelector("#cancel");
const removeBtn = document.querySelector("#remove");
let mode = "login";
let tag = "Todas";
let query = "";
let selected = null;
let timer;
const showError = (el, message) => { el.hidden = !message; el.textContent = message || ""; };

function setMode(next) {
  mode = next;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  authSubmit.textContent = mode === "login" ? "Entrar" : "Crear cuenta";
}
function blank() {
  selected = null;
  form.reset();
  cancelBtn.hidden = true;
  removeBtn.hidden = true;
}
function fill(contact) {
  selected = contact;
  document.querySelector("#name").value = contact.name;
  document.querySelector("#phone").value = contact.phone;
  document.querySelector("#email").value = contact.email;
  document.querySelector("#tag").value = contact.tag;
  document.querySelector("#note").value = contact.note;
  cancelBtn.hidden = false;
  removeBtn.hidden = false;
}
async function loadTags() {
  const data = await api("/api/tags");
  const items = [{ name: "Todas", count: data.tags.reduce((sum, item) => sum + item.count, 0) }, ...data.tags];
  tagsEl.innerHTML = "";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tag${item.name === tag ? " active" : ""}`;
    button.textContent = `${item.name} (${item.count})`;
    button.addEventListener("click", async () => { tag = item.name; await refresh(); });
    tagsEl.append(button);
  });
}
async function loadContacts() {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (tag !== "Todas") params.set("tag", tag);
  const data = await api(`/api/contacts?${params}`);
  listEl.innerHTML = "";
  if (!data.contacts.length) {
    const empty = document.createElement("li");
    empty.textContent = "No hay contactos.";
    listEl.append(empty);
    return;
  }
  data.contacts.forEach((contact) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "item";
    const name = document.createElement("strong");
    name.textContent = contact.name;
    const meta = document.createElement("small");
    meta.textContent = [contact.tag, contact.phone, contact.email].filter(Boolean).join(" \u00b7 ");
    button.append(name, document.createElement("br"), meta);
    button.addEventListener("click", () => fill(contact));
    li.append(button);
    listEl.append(li);
  });
}
async function refresh() {
  await loadTags();
  await loadContacts();
}
async function boot() {
  if (!getToken()) return;
  try {
    const { user } = await api("/api/auth/me");
    authView.classList.add("hidden");
    appView.classList.remove("hidden");
    document.querySelector("#user-name").textContent = user.username;
    blank();
    await refresh();
  } catch {
    clearSession();
  }
}
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(authError, "");
  const fd = new FormData(authForm);
  try {
    const data = await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username: fd.get("username"), password: fd.get("password") }),
    });
    setSession(data.token);
    authForm.reset();
    await boot();
  } catch (err) {
    showError(authError, err.message);
  }
});
document.querySelector("#logout").addEventListener("click", () => {
  clearSession();
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
});
document.querySelector("#search").addEventListener("input", (event) => {
  clearTimeout(timer);
  timer = setTimeout(async () => { query = event.target.value.trim(); await loadContacts(); }, 200);
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError(formError, "");
  const payload = {
    name: document.querySelector("#name").value.trim(),
    phone: document.querySelector("#phone").value.trim(),
    email: document.querySelector("#email").value.trim(),
    tag: document.querySelector("#tag").value.trim(),
    note: document.querySelector("#note").value.trim(),
  };
  try {
    if (selected) await api(`/api/contacts/${selected.id}`, { method: "PATCH", body: JSON.stringify(payload) });
    else await api("/api/contacts", { method: "POST", body: JSON.stringify(payload) });
    blank();
    await refresh();
  } catch (err) {
    showError(formError, err.message);
  }
});
cancelBtn.addEventListener("click", blank);
removeBtn.addEventListener("click", async () => {
  if (!selected) return;
  await api(`/api/contacts/${selected.id}`, { method: "DELETE" });
  blank();
  await refresh();
});
boot();
