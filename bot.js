require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Parser = require('rss-parser');
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ============================================
// CONFIGURAÇÕES
// ============================================

const IMAGEM_PADRAO = "https://raw.githubusercontent.com/HerschelNayuta/Curriculo/refs/heads/main/21_Sem_Titulo_20250204205327.png";

// Lista de instâncias do Nitter para fallback
const NITTER_INSTANCIAS = [
  'https://nitter.kavin.rocks',
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.unixfox.eu',
  'https://nitter.lunar.icu'
];

// Criar pasta database se não existir
if (!fs.existsSync('./database')) {
  fs.mkdirSync('./database');
}

// Carregar perfis
let perfis = { perfis: [] };
try {
  if (fs.existsSync('./perfis.json')) {
    const perfisRaw = fs.readFileSync('./perfis.json', 'utf-8');
    perfis = JSON.parse(perfisRaw);
    console.log(`✅ Carregados ${perfis.perfis.length} perfil(is)`);
  }
} catch (erro) {
  console.error('❌ Erro ao ler perfis.json:', erro.message);
}

// Arquivo de histórico
const dbPath = './database/ultimos-posts.json';
let ultimosPosts = {};
try {
  if (fs.existsSync(dbPath)) {
    ultimosPosts = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  } else {
    fs.writeFileSync(dbPath, '{}');
  }
} catch (erro) {
  ultimosPosts = {};
  fs.writeFileSync(dbPath, '{}');
}

const CHANNEL_ID = process.env.CHANNEL_ID;

// ============================================
// FUNÇÃO PARA TENTAR MÚLTIPLAS INSTÂNCIAS
// ============================================

async function tentarBuscarFeed(usuario, tentativa = 0) {
  if (tentativa >= NITTER_INSTANCIAS.length) {
    throw new Error(`Todas as instâncias falharam para @${usuario}`);
  }
  
  const instancia = NITTER_INSTANCIAS[tentativa];
  const url = `${instancia}/${usuario}/rss`;
  
  try {
    console.log(`   🔄 Tentando instância ${tentativa + 1}/${NITTER_INSTANCIAS.length}: ${instancia}`);
    
    const parser = new Parser({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const feed = await parser.parseURL(url);
    console.log(`   ✅ Conectado via ${instancia}`);
    return feed;
    
  } catch (erro) {
    console.log(`   ⚠️ Falha na instância ${instancia}: ${erro.message}`);
    return tentarBuscarFeed(usuario, tentativa + 1);
  }
}

// ============================================
// FUNÇÃO PARA EXTRAIR IMAGEM
// ============================================

function extrairImagemDoTweet(conteudo) {
  if (!conteudo) return null;
  
  const regexIdImagem = /media\/([A-Za-z0-9_]+)\.(jpg|jpeg|png|gif|webp)/i;
  let match = conteudo.match(regexIdImagem);
  if (match) {
    return `https://pbs.twimg.com/media/${match[1]}.${match[2]}`;
  }
  
  const regexTwimg = /(https?:\/\/pbs\.twimg\.com\/media\/[^\s]+\.(jpg|jpeg|png|gif|webp))/i;
  match = conteudo.match(regexTwimg);
  if (match) {
    return match[1];
  }
  
  return null;
}

// ============================================
// FUNÇÃO PARA LIMPAR TEXTO
// ============================================

function limparTextoDoTweet(texto, nomePerfil, usuario) {
  if (!texto) return "Sem conteúdo";
  
  let textoLimpo = texto.replace(/<[^>]*>/g, '');
  textoLimpo = textoLimpo.replace(new RegExp(`@${usuario}:`, 'gi'), '');
  textoLimpo = textoLimpo.replace(new RegExp(`${nomePerfil}:`, 'gi'), '');
  textoLimpo = textoLimpo.replace(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/gi, '');
  textoLimpo = textoLimpo.replace(/https?:\/\/pbs\.twimg\.com\/media\/[^\s]+/gi, '');
  textoLimpo = textoLimpo.replace(/https?:\/\/t\.co\/[^\s]+/gi, '');
  textoLimpo = textoLimpo.replace(/\s+/g, ' ').trim();
  
  if (textoLimpo.length > 4000) {
    textoLimpo = textoLimpo.substring(0, 3997) + '...';
  }
  
  return textoLimpo || "Sem conteúdo";
}

// ============================================
// FUNÇÃO PARA VERIFICAR NOVIDADES
// ============================================

async function verificarNovidades() {
  const agora = new Date().toLocaleString('pt-BR');
  console.log(`\n🔍 [${agora}] Verificando novidades...`);
  
  if (!perfis.perfis || perfis.perfis.length === 0) {
    console.log('⚠️ Nenhum perfil cadastrado!');
    return;
  }
  
  for (const perfil of perfis.perfis) {
    try {
      console.log(`\n📡 Verificando: @${perfil.usuario} (${perfil.nome})`);
      
      const feed = await tentarBuscarFeed(perfil.usuario);
      const tweets = feed.items;
      
      if (!tweets.length) {
        console.log(`   ℹ️ Nenhum tweet encontrado`);
        continue;
      }
      
      const tweetMaisRecente = tweets[0];
      const tweetId = tweetMaisRecente.link || tweetMaisRecente.id;
      
      if (!ultimosPosts[perfil.id] || ultimosPosts[perfil.id] !== tweetId) {
        console.log(`   ✨ NOVO TWEET detectado!`);
        await enviarTweet(perfil, tweetMaisRecente);
        ultimosPosts[perfil.id] = tweetId;
        fs.writeFileSync(dbPath, JSON.stringify(ultimosPosts, null, 2));
      } else {
        console.log(`   ✅ Nada novo`);
      }
      
    } catch (erro) {
      console.error(`   ❌ Erro em @${perfil.usuario}:`, erro.message);
    }
  }
}

// ============================================
// FUNÇÃO PARA ENVIAR TWEET
// ============================================

async function enviarTweet(perfil, tweet) {
  try {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (!channel) {
      console.error(`❌ Canal ${CHANNEL_ID} não encontrado!`);
      return;
    }
    
    const linkDoTweet = tweet.link;
    const textoOriginal = tweet.content || tweet.contentSnippet || tweet.description || "";
    const textoLimpo = limparTextoDoTweet(textoOriginal, perfil.nome, perfil.usuario);
    
    let dataTweet = "Recentemente";
    if (tweet.pubDate) {
      const data = new Date(tweet.pubDate);
      dataTweet = data.toLocaleString('pt-BR');
    }
    
    const imagemUrl = extrairImagemDoTweet(textoOriginal);
    const imagemFinal = imagemUrl || IMAGEM_PADRAO;
    
    const embed = new EmbedBuilder()
      .setColor(0x1DA1F2)
      .setAuthor({
        name: `${perfil.nome} (@${perfil.usuario})`,
        url: `https://twitter.com/${perfil.usuario}`,
        iconURL: "https://cdn-icons-png.flaticon.com/512/733/733579.png"
      })
      .setDescription(textoLimpo)
      .addFields(
        { name: "📅 Publicado em", value: dataTweet, inline: true },
        { name: "🔗 Link direto", value: `[Clique para ver no Twitter](${linkDoTweet})`, inline: true }
      )
      .setImage(imagemFinal)
      .setTimestamp()
      .setFooter({ 
        text: "Fofocas do Nayuta • Sempre atualizada! 💕",
        iconURL: client.user?.displayAvatarURL()
      });
    
    await channel.send({ 
      content: `🐦 **Nova fofoca do ${perfil.nome}!** 🐦`,
      embeds: [embed] 
    });
    
    console.log(`   ✅ Tweet enviado com sucesso!`);
    console.log(`   📝 ${textoLimpo.substring(0, 100)}...`);
    
  } catch (erro) {
    console.error(`   ❌ Erro ao enviar tweet:`, erro.message);
  }
}

// ============================================
// QUANDO O BOT FICAR ONLINE
// ============================================

client.once('ready', () => {
  console.log(`\n✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨`);
  console.log(`✨   ${client.user.tag} está ONLINE!   ✨`);
  console.log(`✨   Fofocas do Nayuta Prontinha!      ✨`);
  console.log(`✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨✨\n`);
  
  const channel = client.channels.cache.get(CHANNEL_ID);
  if (channel) {
    console.log(`✅ Canal encontrado: #${channel.name} (${CHANNEL_ID})`);
  } else {
    console.log(`❌ Canal ${CHANNEL_ID} NÃO encontrado!`);
  }
  
  console.log(`\n📋 Perfis sendo monitorados:`);
  perfis.perfis.forEach(perfil => {
    console.log(`   🐦 @${perfil.usuario} - ${perfil.nome}`);
  });
  
  const intervalo = parseInt(process.env.CHECK_INTERVAL) || 300000;
  console.log(`\n⏱️ Verificando novidades a cada ${intervalo/1000} segundos`);
  console.log(`🎯 Aguardando novidades...\n`);
  
  setTimeout(() => verificarNovidades(), 5000);
  setInterval(verificarNovidades, intervalo);
});

client.on('error', (erro) => {
  console.error('❌ Erro no cliente Discord:', erro.message);
});

process.on('unhandledRejection', (erro) => {
  console.error('❌ Erro não tratado:', erro);
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ ERRO: Token não encontrado no arquivo .env');
  process.exit(1);
}

client.login(token);
