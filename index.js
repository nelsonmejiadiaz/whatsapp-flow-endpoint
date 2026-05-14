import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;

app.post("/", async (req, res) => {
  const body = req.body;
  if (body?.action === "ping") {
    return res.json({ data: { status: "active" } });
  }
  try {
    const { decryptedBody, aesKey, iv } = decryptRequest(body, PRIVATE_KEY);
    const { action, screen } = decryptedBody;
    let responseData;
    if (action === "INIT") {
      const agencias = await obtenerAgencias();
      responseData = { screen: "FORMULARIO", data: { agencias } };
    } else if (action === "data_exchange" && screen === "FORMULARIO") {
      const { agencia_valor, fecha_inicio_valor, fecha_fin_valor } = decryptedBody.data;
      responseData = { screen: "CONFIRMACION", data: { agencia_valor, fecha_inicio_valor, fecha_fin_valor } };
    }
    const encrypted = encryptResponse(responseData, aesKey, iv);
    res.set("Content-Type", "text/plain");
    res.send(encrypted);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

async function obtenerAgencias() {
  try {
    const response = await fetch(GOOGLE_SHEET_URL, { method: "POST" });
    const json = await response.json();
    return json.data.agencias;
  } catch (e) {
    return [
      { id: "0_Nelson", title: "Agencia Nelson" },
      { id: "1_Mabel", title: "Agencia Mabel" },
      { id: "2_Joan", title: "Agencia Joan" },
      { id: "3_Adriana", title: "Agencia Adriana" },
      { id: "4_Gluky", title: "Agencia Gluky" }
    ];
  }
}

function decryptRequest(body, privatePem) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;
  const aesKey = crypto.privateDecrypt(
    { key: crypto.createPrivateKey(privatePem), padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(encrypted_aes_key, "base64")
  );
  const flowData = Buffer.from(encrypted_flow_data, "base64");
  const iv = Buffer.from(initial_vector, "base64");
  const tag = flowData.subarray(-16);
  const encBody = flowData.subarray(0, -16);
  const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encBody), decipher.final()]);
  return { decryptedBody: JSON.parse(decrypted.toString("utf-8")), aesKey, iv };
}

function encryptResponse(response, aesKey, iv) {
  const flippedIv = Buffer.from(iv.map(b => ~b));
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, flippedIv);
  return Buffer.concat([
    cipher.update(JSON.stringify(response), "utf-8"),
    cipher.final(),
    cipher.getAuthTag()
  ]).toString("base64");
}

app.listen(3000, () => console.log("Servidor activo en puerto 3000"));
