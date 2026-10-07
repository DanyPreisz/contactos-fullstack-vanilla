import { URL } from "node:url";
import { connect, isReady, users, contacts, toId, mapContact } from "./db.js";
import { createApp, readJson, sendEmpty, sendJson, serveStatic } from "./http.js";
import { getUserFromRequest, hashPassword, signToken, verifyPassword } from "./middleware/auth.js";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function usernameQuery(username) {
  return new RegExp("^" + username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
}
function requireUser(req, res) {
  const user = getUserFromRequest(req);
  if (!user) {
    sendJson(res, 401, { error: "No autenticado" });
    return null;
  }
  return user;
}
function cleanTag(value) {
  return String(value || "").trim().slice(0, 24) || "General";
}

const server = createApp(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const { pathname, searchParams } = url;
  const method = req.method || "GET";

  if (pathname === "/health") return sendJson(res, 200, { ok: true, db: isReady() });
  if (pathname.startsWith("/api/") && !isReady()) return sendJson(res, 503, { error: "Base no lista" });
  if (!pathname.startsWith("/api/")) return serveStatic(req, res);

  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await readJson(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!USERNAME_RE.test(username)) return sendJson(res, 400, { error: "Usuario: 3-20 caracteres, letras, numeros y _" });
    if (password.length < 6) return sendJson(res, 400, { error: "La contrasena debe tener al menos 6 caracteres" });
    if (await users().findOne({ username: usernameQuery(username) })) return sendJson(res, 409, { error: "Ese usuario ya existe" });
    const result = await users().insertOne({ username, passwordHash: hashPassword(password), createdAt: new Date() });
    const user = { id: String(result.insertedId), username };
    return sendJson(res, 201, { user, token: signToken(user) });
  }
  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const row = await users().findOne({ username: usernameQuery(username) });
    if (!row || !verifyPassword(password, row.passwordHash)) return sendJson(res, 401, { error: "Usuario o contrasena incorrectos" });
    const user = { id: String(row._id), username: row.username };
    return sendJson(res, 200, { user, token: signToken(user) });
  }
  if (method === "GET" && pathname === "/api/auth/me") {
    const user = requireUser(req, res);
    if (!user) return;
    const id = toId(user.id);
    const row = id ? await users().findOne({ _id: id }) : null;
    if (!row) return sendJson(res, 401, { error: "Usuario no encontrado" });
    return sendJson(res, 200, { user: { id: String(row._id), username: row.username } });
  }

  if (pathname === "/api/contacts" || pathname.startsWith("/api/contacts/") || pathname === "/api/tags") {
    const user = requireUser(req, res);
    if (!user) return;
    const userId = user.id;

    if (method === "GET" && pathname === "/api/tags") {
      const rows = await contacts().aggregate([
        { $match: { userId } },
        { $group: { _id: "$tag", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray();
      return sendJson(res, 200, { tags: rows.map((row) => ({ name: row._id, count: row.count })) });
    }
    if (method === "GET" && pathname === "/api/contacts") {
      const q = String(searchParams.get("q") || "").trim();
      const tag = String(searchParams.get("tag") || "").trim();
      const query = { userId };
      if (tag && tag !== "Todas") query.tag = tag;
      if (q) {
        const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
        query.$or = [{ name: rx }, { phone: rx }, { email: rx }, { note: rx }, { tag: rx }];
      }
      const rows = await contacts().find(query).sort({ name: 1 }).limit(200).toArray();
      return sendJson(res, 200, { contacts: rows.map(mapContact) });
    }
    if (method === "POST" && pathname === "/api/contacts") {
      const body = await readJson(req);
      const name = String(body.name || "").trim();
      if (!name) return sendJson(res, 400, { error: "El nombre es obligatorio" });
      const result = await contacts().insertOne({
        userId,
        name: name.slice(0, 80),
        phone: String(body.phone || "").slice(0, 30),
        email: String(body.email || "").slice(0, 80),
        tag: cleanTag(body.tag),
        note: String(body.note || "").slice(0, 240),
        createdAt: new Date(),
      });
      return sendJson(res, 201, { contact: mapContact(await contacts().findOne({ _id: result.insertedId })) });
    }
    const match = pathname.match(/^\/api\/contacts\/([a-fA-F0-9]{24})$/);
    if (match) {
      const id = toId(match[1]);
      if (method === "PATCH") {
        const existing = await contacts().findOne({ _id: id, userId });
        if (!existing) return sendJson(res, 404, { error: "Contacto no encontrado" });
        const body = await readJson(req);
        const name = body.name !== undefined ? String(body.name).trim() : existing.name;
        if (!name) return sendJson(res, 400, { error: "El nombre no puede estar vacio" });
        await contacts().updateOne({ _id: id, userId }, {
          $set: {
            name: name.slice(0, 80),
            phone: body.phone !== undefined ? String(body.phone).slice(0, 30) : existing.phone,
            email: body.email !== undefined ? String(body.email).slice(0, 80) : existing.email,
            tag: body.tag !== undefined ? cleanTag(body.tag) : existing.tag,
            note: body.note !== undefined ? String(body.note).slice(0, 240) : existing.note,
          },
        });
        return sendJson(res, 200, { contact: mapContact(await contacts().findOne({ _id: id })) });
      }
      if (method === "DELETE") {
        const result = await contacts().deleteOne({ _id: id, userId });
        if (!result.deletedCount) return sendJson(res, 404, { error: "Contacto no encontrado" });
        return sendEmpty(res, 204);
      }
    }
  }
  sendJson(res, 404, { error: "Ruta no encontrada" });
});

server.listen(PORT, HOST, () => console.log(`Contactos en http://${HOST}:${PORT}`));
async function bootDb() {
  for (;;) {
    try {
      await connect();
      return;
    } catch (err) {
      console.error("Mongo no disponible:", err.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
bootDb();
