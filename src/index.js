const express = require('express');
const app = express();
const cors = require('cors');
const fs = require("fs");
const open = require('open');
const path = require('path');
const ytdl = require("@distube/ytdl-core");
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Configura o CORS para aceitar requisições de uma origem específica
app.use(cors({
  origin: '*', // Permitir todas as origens (ou especifique a sua)
  exposedHeaders: ['X-Video-Title'] // Exponha o cabeçalho customizado
}));

const dotenv = require('dotenv');
dotenv.config()

puppeteer.use(StealthPlugin());

app.use(express.json()); // Middleware para análise de solicitações JSON

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "public/views"));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from the public folder

const router = express.Router();

app.get('/', (req, res) => {
  res.render('index');
});

// fetchLatestVideo
const fetchLatestVideo = async (req, res, next) => {
  const { channelYouTube } = req.body;
  console.log(channelYouTube, "fetchLatestVideo middleware")

  if (!channelYouTube) {
    return res.status(400).json({ error: "O parâmetro 'channelYouTube' é obrigatório." });
  }

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', // Executa o Chromium sem sandboxing, necessário para que funcione em ambientes restritos como o Heroku.
        '--disable-setuid-sandbox', // Desativa o setuid sandboxing, uma opção adicional para ambientes onde o sandboxing tradicional não é possível.
        '--disable-dev-shm-usage', // Usa /tmp ao invés de /dev/shm, útil em ambientes com pouca memória compartilhada.
        '--disable-accelerated-2d-canvas', // Desativa a aceleração de canvas 2D, o que pode melhorar a estabilidade em ambientes headless.
        '--no-first-run', // Ignora a mensagem de "primeira execução" do Chrome, acelerando o tempo de inicialização.
        '--no-zygote', // Desativa o processo zygote, usado no Chromium para gerenciar processos filhos de forma eficiente, reduzindo o overhead.
        '--single-process', // Executa tudo em um único processo, o que pode ser útil em ambientes restritos em termos de recursos.
        '--disable-gpu' // Desativa a renderização via GPU, geralmente desnecessária em ambientes headless.
      ]
    });

    const page = await browser.newPage();

    // Acesse o canal do YouTube
    const channelURL = `https://www.youtube.com/@${channelYouTube}/videos`;
    await page.goto(channelURL, { waitUntil: "load" });
    // Aguarde o carregamento dos vídeos
    await page.waitForSelector('a#thumbnail[href^="/watch"]', { timeout: 60000 });

    // Aguarde carregar os vídeos e pegue o link do primeiro vídeo
    const latestVideoLink = await page.evaluate(() => {
      // const videoElement = document.querySelector("a#thumbnail");
      const videoElement = document.querySelector('a#thumbnail[href^="/watch"]');
      return videoElement ? `https://www.youtube.com${videoElement.getAttribute("href")}` : null;
    });

    await browser.close();

    if (!latestVideoLink) {
      return res.status(404).json({ error: "Nenhum vídeo encontrado para este canal." });
    }

    req.latestVideoLink = latestVideoLink
    next()
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erro ao buscar o vídeo mais recente." });
  }
}

const loadCookies = () => {
  try {
    const cookies = JSON.parse(fs.readFileSync("cookies.json", "utf8"));
    return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
  } catch (error) {
    console.error("Erro ao carregar cookies:", error);
    return "";
  }
};

// processVideo
const processVideo = async (req, res) => {
  const videoUrl = req.latestVideoLink
  console.log(videoUrl, "middleware")

  if (!videoUrl || !ytdl.validateURL(videoUrl)) {
    return res.status(400).json({ error: "URL de vídeo inválida ou não fornecida." });
  }

  try {
    let info = await ytdl.getInfo(videoUrl);

    // Obtém o título do vídeo
    let videoTitle = info.videoDetails.title;
    const sanitizedTitle = videoTitle.replace(/[^a-zA-Z0-9\s]/g, '');

    // Obtém a duração do vídeo em segundos
    const videoDurationInSeconds = parseInt(info.videoDetails.lengthSeconds, 10);

    // Converte para minutos e verifica se é maior ou menor que 60 minutos
    const videoDurationInMinutes = Math.floor(videoDurationInSeconds / 60);

    // if (videoDurationInMinutes >= 12) {
    //   console.log(`O vídeo tem ${videoDurationInMinutes} minutos, mais de 12 minutos.`);
    //   res.send({ timeLimit: 'o video tem mais de 11 minutos' })
    //   return res.end(); // <-- Encerra explicitamente a resposta
    // }

    let audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

    console.log('Formats with only audio: ' + audioFormats.length);
    if (audioFormats.length === 0) {
      return res.status(404).json({ error: "Nenhum formato de áudio disponível para este vídeo." });
    }

    // Seleciona o formato de áudio com a melhor qualidade (pode ser ajustado conforme necessário)
    const audio = audioFormats[0]; // Ou, por exemplo, selecione o de maior bitrate

    // Adiciona cookies carregados no cabeçalho da requisição
    const cookies = loadCookies()

    // Configura o cabeçalho para download
    res.setHeader("Content-Disposition", `attachment; filename="${sanitizedTitle}.mp3"`);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader("X-Video-Title", sanitizedTitle); // Cabeçalho customizado para o título

    // Baixa o áudio e encaminha para o cliente
    // const stream = ytdl(videoUrl, { format: audio, quality: "highestaudio" })
    const stream = ytdl(videoUrl, {
      format: audio,
      filter: "audioonly",
      quality: "highestaudio",
      requestOptions: {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Cookie": cookies,
        },
      },
    });

    // Encaminha o stream para a resposta
    stream.pipe(res);

    // Trata eventos de erro no stream
    stream.on("error", (err) => {
      console.error("Erro no stream:", err);
      // res.status(500).send("Erro ao processar o download.");
      res.end(); // Fecha a resposta no caso de erro
    });

    // Confirmação no final do download
    stream.on("end", () => {
      console.log("Download concluído.");
      res.end(); // Confirma o encerramento
    });

  } catch (error) {
    console.error("Erro ao baixar o áudio:", error);
    res.status(500).json({ error: "Erro ao baixar o áudio." });
  }
}

router.post("/yt-audio-mp3", fetchLatestVideo, processVideo);

app.use(router);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`The server is now running on port ${PORT}`);
  open(`http://localhost:${PORT}`);
});
