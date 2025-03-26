import { Client, LocalAuth, Message } from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

// Definindo tipos para o histórico de conversas
interface ConversationHistory {
  [userId: string]: { role: string; content: string }[];
}

interface Meeting {
  date: string; // Ex: "2025-03-26"
  dayOfWeek: string; // Ex: "Quarta-feira"
  time: string; // Ex: "14:00"
  name: string; // Nome do cliente
}

// Objeto para armazenar o histórico de conversas
const conversationHistory: ConversationHistory = {};
let meetings: Meeting[] = [];

// Função para agendar uma reunião
function scheduleMeeting(date: string, dayOfWeek: string, time: string, name: string) {
  meetings.push({ date, dayOfWeek, time, name });
  saveMeetings();
}

// Função para carregar as reuniões do arquivo JSON
function loadMeetings() {
  if (fs.existsSync("meetings.json")) {
    const data = fs.readFileSync("meetings.json", "utf-8");
    meetings = JSON.parse(data);
  }
}

// Função para salvar as reuniões no arquivo JSON
function saveMeetings() {
  fs.writeFileSync("meetings.json", JSON.stringify(meetings, null, 2));
}

// Lista de horários disponíveis
const availableTimes = ["14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00"];

// Função para verificar se o horário está disponível em um determinado dia
function isTimeAvailable(date: string, time: string): boolean {
  return !meetings.some(meeting => meeting.date === date && meeting.time === time);
}

// Função para encontrar o próximo horário disponível
function getNextAvailableTime(date: string): string | null {
  return availableTimes.find(time => isTimeAvailable(date, time)) || null;
}

// Função para obter a data de amanhã no formato "YYYY-MM-DD" e o dia da semana
function getTomorrowDate(): { date: string; dayOfWeek: string } {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const date = tomorrow.toISOString().split("T")[0]; // Formato YYYY-MM-DD
  const daysOfWeek = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
  const dayOfWeek = daysOfWeek[tomorrow.getDay()];

  return { date, dayOfWeek };
}

// Função para processar mensagens usando GPT-4 Mini com histórico
async function processMessage(text: string, userId: string): Promise<string> {
  try {
    if (!conversationHistory[userId]) {
      conversationHistory[userId] = [];
    }

    conversationHistory[userId].push({ role: "user", content: text });

    if (conversationHistory[userId].length > 10) {
      conversationHistory[userId].shift();
    }

    const { date, dayOfWeek } = getTomorrowDate();
    const nextAvailableTime = getNextAvailableTime(date);

    // Se não houver horário disponível, informe ao usuário
    if (!nextAvailableTime) {
      return "Infelizmente, todos os horários para amanhã estão preenchidos. Podemos marcar para outro dia?";
    }

    // Lista de horários já ocupados no dia seguinte
    const bookedTimes = meetings
      .filter(meeting => meeting.date === date)
      .map(meeting => meeting.time)
      .join(", ") || "Nenhum";

    // Criando um prompt atualizado
    const prompt = `
      Seu nome é Guilherme Barbosa e você é fundador da Genesis, uma agência de marketing que ajuda outras agências a expandir sem aumentar os custos fixos. Nosso modelo é simples: **um preço fixo mensal**, sem custos extras, independente do número de projetos ou demandas. A Genesis é especializada em serviços de marketing, como Google Ads, SEO, e branding.

      **Regras importantes**:
      1. Seja breve e direto, com respostas naturais e sem ser muito formal. Nada de textos longos.
      2. **Sempre chame para uma reunião** apenas se estiver falando com a pessoa correta. Se não for a pessoa que estamos procurando (geralmente o CEO ou responsável por branding), peça educadamente para redirecionar a conversa para quem podemos falar.
      3. **Busque o nome da pessoa** ao longo da conversa. Caso o nome não apareça, pergunte diretamente.
      4. O foco inicial deve ser sempre em **marketing e branding**. Vamos sempre dizer que estamos interessados nos serviços de branding deles e gostaríamos de agendar uma reunião para discutir.
      5. Sempre marque a reunião primeiro já mandando um horário do dia seguinte (${dayOfWeek}). Os horários disponíveis são: ${availableTimes.join(", ")}, mas evite sugerir os horários já ocupados: ${bookedTimes}.
      6. **Confirme sempre o dia e o horário antes de marcar definitivamente a reunião**.
      7. Se o usuário solicitar um horário indisponível, diga que não consegue e ofereça outro.
      8. Sempre finalize com **"Reunião Agendada!"** após a confirmação.
      9. Sempre marque para amanhã (${dayOfWeek}) ou outro dia se necessário.

      Evite respostas juntas como a seguinte:
      Perfeito! Então, tá agendado para amanhã (Quinta-feira) às 14:00. Estou ansioso para nossa conversa!
      Reunião Agendada! Desculpe, esse horário já está ocupado. Por favor, escolha outro horário.

      **Exemplo de abordagem**:
      - "Oi, tudo bem? Estamos interessados nos serviços de branding de sua agência e gostaríamos de agendar uma reunião para conversar sobre como podemos colaborar. Podemos falar amanhã (${dayOfWeek}) às ${nextAvailableTime}?"
    `;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: prompt },
          ...conversationHistory[userId],
        ],
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    let reply = response.data.choices[0].message.content;
    reply = reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Verifica se a resposta contém "Reunião Agendada!"
    if (reply.includes("Reunião Agendada!")) {
      const timeMatch = reply.match(/(\d{2}:\d{2})/);

      if (timeMatch) {
        const time = timeMatch[0];
        const name = conversationHistory[userId].find(msg => msg.role === "user")?.content || "Cliente";

        if (isTimeAvailable(date, time)) {
          scheduleMeeting(date, dayOfWeek, time, name);
          console.log(`✅ Reunião agendada para ${dayOfWeek}, ${date} às ${time} com ${name}`);
        } else {
          reply += `\nDesculpe, esse horário já está ocupado. Por favor, escolha outro horário.`;
        }
      }
    }

    conversationHistory[userId].push({ role: "assistant", content: reply });

    console.log(`Resposta gerada para ${userId}: ${reply}`);
    return reply;
  } catch (error) {
    console.error("Erro ao processar mensagem:", error);
    return "";
  }
}

// Inicializa o cliente do WhatsApp
const client = new Client({ authStrategy: new LocalAuth() });

client.on("qr", (qr: string) => qrcode.generate(qr, { small: true }));
client.on("ready", () => { console.log("Pronto para uso!"); loadMeetings(); });
client.on("message", async (message: Message) => {
  console.log(`Mensagem recebida de ${message.from}: ${message.body}`);
  const response = await processMessage(message.body, message.from);
  message.reply(response);
});
client.initialize();
