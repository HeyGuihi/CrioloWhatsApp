import { Client, LocalAuth } from "whatsapp-web.js";
import fs from "fs";
import dotenv from "dotenv";

// Carregar variáveis de ambiente do arquivo .env
dotenv.config();

// Criar cliente do WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(),
});

import qrcode from "qrcode-terminal";

client.on("qr", (qr: string) => {
  console.log("Escaneie o QR code para autenticar.");
  qrcode.generate(qr, { small: true }); // Gera o QR Code no terminal
});


client.on("ready", async () => {
  console.log("✅ Cliente do WhatsApp pronto!");

  // Carregar contatos do JSON
  const contacts = loadContacts();

  // Disparar mensagens personalizadas
  for (const contact of contacts) {
    const message = `Olá, boa tarde! Poderia me confirmar se estou falando com o CEO? Caso não, poderia me direcionar para ele, por favor? Temos interesse em entender melhor como funciona a [NOME].`;

    // Substituir [NOME] pelo nome do contato
    const personalizedMessage = message.replace("[NOME]", contact.name);

    // Enviar mensagem
    await sendMessage(contact.phone, personalizedMessage);
  }
});

function loadContacts() {
  try {
    const data = fs.readFileSync("contacts.json", "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("❌ Erro ao carregar contatos:", error);
    return [];
  }
}

async function sendMessage(phone: string, message: string) {
  const chatId = `${phone}@c.us`;

  try {
    await client.sendMessage(chatId, message);
    console.log(`📩 Mensagem enviada para ${phone}: ${message}`);
  } catch (error) {
    console.error(`❌ Erro ao enviar mensagem para ${phone}:`, error);
  }
}

client.initialize();
