import { MongoClient, ObjectId } from "mongodb";

const uri = process.env.MONGODB_URI || "";
const dbName = process.env.MONGODB_DB || "contactos";
let db;

export function isReady() {
  return Boolean(db);
}

export async function connect() {
  if (!uri) throw new Error("Falta MONGODB_URI");
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  db = client.db(dbName);
  await db.collection("users").createIndex({ username: 1 }, { unique: true });
  await db.collection("contacts").createIndex({ userId: 1, name: 1 });
  await db.collection("contacts").createIndex({ userId: 1, tag: 1 });
  console.log(`MongoDB conectado (${dbName})`);
  return db;
}

export const users = () => db.collection("users");
export const contacts = () => db.collection("contacts");

export function toId(value) {
  if (!ObjectId.isValid(value)) return null;
  return new ObjectId(String(value));
}

export function mapContact(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    phone: doc.phone || "",
    email: doc.email || "",
    tag: doc.tag || "General",
    note: doc.note || "",
    createdAt: doc.createdAt,
  };
}
