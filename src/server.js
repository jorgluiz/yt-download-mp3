const express = require('express');
const app = express();
const router = express.Router();
const open = require('open');
const path = require('path');

const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const puppeteer = require('puppeteer-extra');

const ytdl = require("@distube/ytdl-core"); // CommonJS
const cookie = fs.readFileSync('cookies.txt', 'utf-8');

const dotenv = require('dotenv');
dotenv.config()

puppeteer.use(StealthPlugin());

app.use(express.json()); // Middleware para análise de solicitações JSON

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "public/views"));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from the public folder

app.get('/', (req, res) => {
  res.render('index');
});

// fetchLatestVideo
const fetchLatestVideo = async (req, res, next) => {
  const { channelYouTube } = req.body;
  console.log(channelYouTube, "fetchLatestVideo")

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
      ],
      executablePath: process.env.CHROME_BIN || null, // Necessário para Heroku
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

const { exec } = require('child_process');


const processVideo = async (req, res) => {
  const videoUrl = req.latestVideoLink;
  if (!videoUrl) {
    return res.status(400).json({ error: "URL de vídeo inválida ou não fornecida." });
  }

  const outputFilePath = path.join(__dirname, 'downloads', 'audio.mp3');

  exec(`yt-dlp -f bestaudio --extract-audio --audio-format mp3 -o "${outputFilePath}" ${videoUrl}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Erro ao executar yt-dlp: ${error.message}`);
      return res.status(500).json({ error: "Erro ao processar o vídeo." });
    }

    res.download(outputFilePath, 'audio.mp3', (err) => {
      if (err) console.error("Erro ao enviar o arquivo:", err);
    });
  });
};

// processVideo
// const processVideo = async (req, res) => {
//   const videoUrl = req.latestVideoLink
//   console.log(videoUrl, "rota: download-mp3")

//   if (!videoUrl || !ytdl.validateURL(videoUrl)) {
//     return res.status(400).json({ error: "URL de vídeo inválida ou não fornecida." });
//   }

//   try {
//     let info = await ytdl.getInfo(videoUrl);

//     // Obtém o título do vídeo
//     let videoTitle = info.videoDetails.title;
//     console.log("Título do vídeo:", videoTitle);

//     let audioFormats = ytdl.filterFormats(info.formats, 'audioonly');

//     console.log('Formats with only audio: ' + audioFormats.length);
//     if (audioFormats.length === 0) {
//       return res.status(404).json({ error: "Nenhum formato de áudio disponível para este vídeo." });
//     }

//     // Seleciona o formato de áudio com a melhor qualidade (pode ser ajustado conforme necessário)
//     const audio = audioFormats[0]; // Ou, por exemplo, selecione o de maior bitrate

//     // Configura o cabeçalho para download
//     res.setHeader("Content-Disposition", `attachment; filename="${videoTitle}.mp3"`);
//     res.setHeader("Content-Type", "audio/mpeg");
//     res.setHeader("X-Video-Title", videoTitle); // Cabeçalho customizado para o título

//     // Baixa o áudio e encaminha para o cliente
//     const stream = ytdl(videoUrl, {
//       format: audio,
//       filter: "audioonly",
//       quality: "highestaudio",
//       requestOptions: {
//         headers: {
//           "User-Agent": "Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.101 Mobile Safari/537.36",
//         },
//       },
//     })

//     // Encaminha o stream para a resposta
//     stream.pipe(res);

//     // Trata eventos de erro no stream
//     stream.on("error", (err) => {
//       console.error("Erro no stream:", err);
//       // res.status(500).send("Erro ao processar o download.");
//       res.end(); // Fecha a resposta no caso de erro
//     });

//     // Confirmação no final do download
//     stream.on("end", () => {
//       console.log("Download concluído.");
//       res.end(); // Confirma o encerramento
//     });

//   } catch (error) {
//     console.error("Erro ao baixar o áudio:", error);
//     res.status(500).json({ error: "Erro ao baixar o áudio." });
//   }
// }

router.post("/latest-video", fetchLatestVideo, processVideo);

// Attach router to the app
app.use(router);


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`The server is now running on port ${PORT}`);
  open(`http://localhost:${PORT}`);
});
