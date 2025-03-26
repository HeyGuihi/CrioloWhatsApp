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
  date: string; // Data da reunião
  time: string; // Hora da reunião
  name: string; // Nome da pessoa
}

// Objeto para armazenar o histórico de conversas
const conversationHistory: ConversationHistory = {};

// Estrutura para armazenar as reuniões agendadas
let meetings: Meeting[] = [];

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

// Função para verificar se o horário está disponível
function isTimeAvailable(time: string): boolean {
  return !meetings.some(meeting => meeting.time === time);
}

// Função para agendar a reunião
function scheduleMeeting(date: string, time: string, name: string) {
  meetings.push({ date, time, name });
  saveMeetings(); // Salva as reuniões no arquivo
}

// Função para processar mensagens usando GPT-4 Mini com histórico
async function processMessage(text: string, userId: string): Promise<string> {
  try {
    // Inicializa o histórico do usuário, se não existir
    if (!conversationHistory[userId]) {
      conversationHistory[userId] = [];
    }

    // Adiciona a mensagem do usuário ao histórico
    conversationHistory[userId].push({ role: "user", content: text });

    // Limita o histórico para as últimas 10 interações
    if (conversationHistory[userId].length > 10) {
      conversationHistory[userId].shift();
    }

    // Atualiza o prompt para incluir horários disponíveis
    const availableTimes = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
    const availableTimesText = availableTimes.join(", ");

    const prompt = `
      Seu nome é Guilherme Barbosa e você é fundador da Genesis, uma agência de marketing que ajuda outras agências a expandir sem aumentar os custos fixos. Nosso modelo é simples: **um preço fixo mensal**, sem custos extras, independente do número de projetos ou demandas. A Genesis é especializada em serviços de marketing, como Google Ads, SEO, e branding.

      **Regras importantes**:
      1. Seja breve e direto, com respostas naturais e sem ser muito formal. Nada de textos longos.
      2. **Sempre chame para uma reunião** apenas se estiver falando com a pessoa correta. Se não for a pessoa que estamos procurando (geralmente o CEO ou responsável por branding), peça educadamente para redirecionar a conversa para quem podemos falar.
      3. **Busque o nome da pessoa** ao longo da conversa. Caso o nome não apareça, pergunte diretamente. Use o histórico da conversa (conversationHistory[userId]) para identificar quem está falando.
      4. O foco inicial deve ser sempre em **marketing e branding**. Vamos sempre dizer que estamos interessados nos serviços de branding deles e gostaríamos de agendar uma reunião para discutir.
      5. Sempre marque a reunião primeiro já mandando um horário do dia. Os horários disponíveis são: ${availableTimesText}.
      6. Caso um horário seja escolhido, verifique se já está ocupado. Se já estiver agendado, sugira outro horário.

      **Exemplo de abordagem**:
      - "Oi, tudo bem? Estamos interessados nos serviços de branding de sua agência e gostaríamos de agendar uma reunião para conversar sobre como podemos colaborar. Quando seria um bom horário?"
      - Se não for a pessoa procurada: "Entendi, obrigado! Poderia me direcionar para o CEO da sua agência?"

      **Evite**:
      - Explicações longas sobre a Genesis.
      - Enrolação. O foco é agendar a reunião, nada mais.

      Sempre que possível, **chame para uma reunião** sem enrolação, mantendo o tom direto, mas amigável, e somente se for a pessoa correta.
    `;

    // Requisição para a API da OpenAI (GPT-4 Mini)
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini", // Modelo GPT-4 Mini
        messages: [
          { role: "system", content: prompt },
          ...conversationHistory[userId], // Envia o histórico completo do usuário
        ],
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, // Usando a chave secreta da API
          "Content-Type": "application/json",
        },
      }
    );

    let reply = response.data.choices[0].message.content;

    // Remove qualquer <think>...</think> antes de responder
    reply = reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Verifica se a resposta contém um horário para agendar a reunião
    const timeMatch = reply.match(/(\d{2}:\d{2})/);
    if (timeMatch) {
      const time = timeMatch[0];
      if (isTimeAvailable(time)) {
        const name = conversationHistory[userId].find(msg => msg.role === "user")?.content || "Cliente";
        scheduleMeeting("2025-03-25", time, name);  // Data fictícia para agendamento
        reply += `\nReunião confirmada para ${time}.`;
      } else {
        reply += `\nDesculpe, esse horário já está ocupado. Por favor, escolha outro horário.`;
      }
    }

    // Adiciona a resposta da IA ao histórico
    conversationHistory[userId].push({ role: "assistant", content: reply });

    console.log(`Resposta gerada para ${userId}: ${reply}`);
    return reply;
  } catch (error) {
    console.error("Erro ao processar mensagem:", error);
    return "";
  }
}

// Inicializa o cliente do WhatsApp
const client = new Client({
  authStrategy: new LocalAuth(), // Salva a sessão localmente
});

// Gera o QR Code no terminal
client.on("qr", (qr: string) => {
  qrcode.generate(qr, { small: true });
});

// Quando estiver pronto, exibe uma mensagem
client.on("ready", () => {
  console.log("Pronto para uso!");
  loadMeetings(); // Carrega as reuniões existentes ao iniciar
});

// Escuta mensagens recebidas
client.on("message", async (message: Message) => {
  console.log(`Mensagem recebida de ${message.from}: ${message.body}`);

  // Processa a mensagem com GPT-4 Mini usando o histórico
  const response = await processMessage(message.body, message.from);

  // Responde a mensagem no WhatsApp
  message.reply(response);
});

// Inicializa o cliente
client.initialize();
