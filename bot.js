require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const Parser = require('rss-parser');
const fs = require('fs');

const parser = new Parser();
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

// Criar pasta database se não existir
if (!fs.existsSync('./database')) {
  fs.mkdirSync('./database');
}

// Carregar perfis do arquivo perfis.json
let perfis = { perfis: [] };
try {
  if (fs.existsSync('./perfis.json')) {
    const perfisRaw = fs.readFileSync('./perfis.json', 'utf-8');
    perfis = JSON.parse(perfisRaw);
    console.log(`✅ Carregados ${perfis.perfis.length} perfil(is) do arquivo perfis.json`);
  } else {
    console.log('⚠️ Arquivo perfis.json não encontrado!');
  }
} catch (erro) {
  console.error('❌ Erro ao ler perfis.json:', erro.message);
}

// Arquivo para guardar último post enviado
const dbPath = './database/ultimos-posts.json';
let ultimosPosts = {};
try {
  if (fs.existsSync(dbPath)) {
    ultimosPosts = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
  } else {
    fs.writeFileSync(dbPath, '{}');
  }
} catch (erro) {
  console.log('⚠️ Criando novo arquivo de histórico...');
  ultimosPosts = {};
  fs.writeFileSync(dbPath, '{}');
}

const CHANNEL_ID = process.env.CHANNEL_ID;

// ============================================
// FUNÇÃO PARA EXTRAIR IMAGEM DO TWEET (CORRIGIDA)
// ============================================

function extrairImagemDoTweet(conteudo, tweetCompleto) {
  // Primeiro, tenta extrair o ID da imagem do conteúdo
  if (conteudo) {
    // Padrão para IDs de imagem do Twitter (formato: media/HF6J3bZXkAAq62N.jpg)
    const regexIdImagem = /media\/([A-Za-z0-9_]+)\.(jpg|jpeg|png|gif|webp)/i;
    let match = conteudo.match(regexIdImagem);
    if (match) {
      const imagemId = match[1];
      const extensao = match[2];
      const twitterUrl = `https://pbs.twimg.com/media/${imagemId}.${extensao}`;
      console.log(`   📷 ID da imagem: ${imagemId}`);
      console.log(`   📷 URL Twitter: ${twitterUrl.substring(0, 80)}...`);
      return twitterUrl;
    }
    
    // Padrão para URLs do Nitter com %2F
    const regexNitterUrl = /nitter\.net\/pic\/media%2F([A-Za-z0-9_]+)\.(jpg|jpeg|png|gif|webp)/i;
    match = conteudo.match(regexNitterUrl);
    if (match) {
      const imagemId = match[1];
      const extensao = match[2];
      const twitterUrl = `https://pbs.twimg.com/media/${imagemId}.${extensao}`;
      console.log(`   📷 Convertido Nitter → Twitter: ${twitterUrl.substring(0, 80)}...`);
      return twitterUrl;
    }
    
    // URLs diretas do Twitter
    const regexTwimg = /(https?:\/\/pbs\.twimg\.com\/media\/[^\s]+\.(jpg|jpeg|png|gif|webp))/i;
    match = conteudo.match(regexTwimg);
    if (match) {
      console.log(`   📷 URL Twitter direta encontrada`);
      return match[1];
    }
  }
  
  // Campo enclosure do RSS
  if (tweetCompleto && tweetCompleto.enclosure && tweetCompleto.enclosure.url) {
    const matchId = tweetCompleto.enclosure.url.match(/media%2F([A-Za-z0-9_]+)\./i);
    if (matchId) {
      const twitterUrl = `https://pbs.twimg.com/media/${matchId[1]}.jpg`;
      console.log(`   📷 Enclosure convertido: ${twitterUrl.substring(0, 80)}...`);
      return twitterUrl;
    }
  }
  
  console.log(`   📷 Nenhuma imagem encontrada, usando padrão`);
  return null;
}

// ============================================
// FUNÇÃO PARA LIMPAR O TEXTO DO TWEET
// ============================================

function limparTextoDoTweet(texto, nomePerfil, usuario) {
  if (!texto) return "Sem conteúdo";
  
  // Remover tags HTML
  let textoLimpo = texto.replace(/<[^>]*>/g, '');
  
  // Remover menções ao perfil
  textoLimpo = textoLimpo.replace(new RegExp(`@${usuario}:`, 'gi'), '');
  textoLimpo = textoLimpo.replace(new RegExp(`${nomePerfil}:`, 'gi'), '');
  
  // Remover "Tweet from @usuario"
  textoLimpo = textoLimpo.replace(new RegExp(`Tweet from @${usuario}`, 'gi'), '');
  
  // Remover URLs de imagem (deixar só o texto)
  textoLimpo = textoLimpo.replace(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/gi, '');
  textoLimpo = textoLimpo.replace(/https?:\/\/pbs\.twimg\.com\/media\/[^\s]+/gi, '');
  textoLimpo = textoLimpo.replace(/https?:\/\/nitter\.net\/pic\/[^\s]+/gi, '');
  
  // Remover URLs do Twitter
  textoLimpo = textoLimpo.replace(/https?:\/\/t\.co\/[^\s]+/gi, '');
  
  // Remover espaços extras
  textoLimpo = textoLimpo.replace(/\s+/g, ' ').trim();
  
  // Limitar tamanho (Discord permite até 4000 caracteres)
  if (textoLimpo.length > 4000) {
    textoLimpo = textoLimpo.substring(0, 3997) + '...';
  }
  
  return textoLimpo || "Sem conteúdo";
}

// ============================================
// FUNÇÃO PARA VERIFICAR NOVOS TWEETS
// ============================================

async function verificarNovidades() {
  const agora = new Date().toLocaleString('pt-BR');
  console.log(`\n🔍 [${agora}] Verificando novidades...`);
  
  if (!perfis.perfis || perfis.perfis.length === 0) {
    console.log('⚠️ Nenhum perfil cadastrado! Adicione perfis no arquivo perfis.json');
    return;
  }
  
  for (const perfil of perfis.perfis) {
    try {
      console.log(`📡 Verificando: @${perfil.usuario} (${perfil.nome})`);
      
      const feed = await parser.parseURL(perfil.feedUrl);
      const tweets = feed.items;
      
      if (!tweets.length) {
        console.log(`   ℹ️ Nenhum tweet encontrado`);
        continue;
      }
      
      const tweetMaisRecente = tweets[0];
      const tweetId = tweetMaisRecente.link || tweetMaisRecente.id;
      
      // Verificar se já foi enviado
      if (!ultimosPosts[perfil.id] || ultimosPosts[perfil.id] !== tweetId) {
        console.log(`   ✨ NOVO TWEET detectado!`);
        await enviarTweet(perfil, tweetMaisRecente);
        ultimosPosts[perfil.id] = tweetId;
        
        // Salvar após cada envio
        fs.writeFileSync(dbPath, JSON.stringify(ultimosPosts, null, 2));
      } else {
        console.log(`   ✅ Nada novo`);
      }
      
    } catch (erro) {
      console.error(`   ❌ Erro em @${perfil.usuario}:`, erro.message);
      
      // Dica útil se o Nitter estiver fora
      if (erro.message.includes('404') || erro.message.includes('ENOTFOUND')) {
        console.log(`   💡 Dica: O Nitter pode estar fora. Tente trocar 'nitter.net' por 'nitter.poast.org' no perfis.json`);
      }
    }
  }
}

// ============================================
// FUNÇÃO PARA ENVIAR TWEET NO DISCORD
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
    
    // Extrair imagem (já retorna URL do Twitter correta)
    let imagemUrl = extrairImagemDoTweet(textoOriginal, tweet);
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
      .setTimestamp()
      .setFooter({ 
        text: "Fofocas do Nayuta • Sempre atualizada! 💕",
        iconURL: client.user?.displayAvatarURL()
      });
    
    if (imagemUrl) {
      embed.setImage(imagemUrl);
      console.log(`   📷 Imagem adicionada ao embed`);
    } else {
      embed.setImage(IMAGEM_PADRAO);
      console.log(`   🖼️ Usando imagem padrão`);
    }
    
    // Enviar mensagem
    await channel.send({ 
      content: `🐦 **Nova fofoca do ${perfil.nome}!** 🐦`,
      embeds: [embed] 
    });
    
    console.log(`   ✅ Tweet enviado com sucesso!`);
    console.log(`   📝 Conteúdo: ${textoLimpo.substring(0, 100)}...`);
    
  } catch (erro) {
    console.error(`   ❌ Erro ao enviar tweet:`, erro.message);
    
    // Tentativa de fallback: enviar sem imagem
    if (erro.message.includes('Timeout') || erro.message.includes('ECONN') || erro.message.includes('fetch')) {
      console.log(`   🔄 Tentando enviar sem imagem (fallback)...`);
      try {
        const channel = client.channels.cache.get(CHANNEL_ID);
        const linkDoTweet = tweet.link;
        const textoOriginal = tweet.content || tweet.contentSnippet || tweet.description || "";
        const textoLimpo = limparTextoDoTweet(textoOriginal, perfil.nome, perfil.usuario);
        
        let dataTweet = "Recentemente";
        if (tweet.pubDate) {
          const data = new Date(tweet.pubDate);
          dataTweet = data.toLocaleString('pt-BR');
        }
        
        const embedSemImagem = new EmbedBuilder()
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
          .setImage(IMAGEM_PADRAO)
          .setTimestamp()
          .setFooter({ text: "Fofocas do Nayuta • Sempre atualizada! 💕" });
        
        await channel.send({ 
          content: `🐦 **Nova fofoca do ${perfil.nome}!** 🐦`,
          embeds: [embedSemImagem] 
        });
        console.log(`   ✅ Tweet enviado com imagem padrão (fallback)`);
      } catch (fallbackErro) {
        console.error(`   ❌ Fallback também falhou:`, fallbackErro.message);
      }
    }
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
  
  // Verificar canal
  const channel = client.channels.cache.get(CHANNEL_ID);
  if (channel) {
    console.log(`✅ Canal encontrado: #${channel.name} (${CHANNEL_ID})`);
  } else {
    console.log(`❌ Canal ${CHANNEL_ID} NÃO encontrado!`);
    console.log(`💡 Verifique se o bot está no servidor e se o ID está correto\n`);
    console.log(`📋 Canais disponíveis:`);
    client.channels.cache.forEach(c => {
      if (c.type === 0) console.log(`   - #${c.name} (${c.id})`);
    });
  }
  
  // Mostrar perfis monitorados
  console.log(`\n📋 Perfis sendo monitorados:`);
  if (perfis.perfis && perfis.perfis.length > 0) {
    perfis.perfis.forEach(perfil => {
      console.log(`   🐦 @${perfil.usuario} - ${perfil.nome}`);
    });
  } else {
    console.log(`   ⚠️ Nenhum perfil configurado!`);
    console.log(`   💡 Edite o arquivo perfis.json e adicione os perfis desejados`);
  }
  
  // Configurar verificações
  const intervalo = parseInt(process.env.CHECK_INTERVAL) || 300000;
  console.log(`\n⏱️ Verificando novidades a cada ${intervalo/1000} segundos`);
  console.log(`🎯 Aguardando novidades...\n`);
  
  // Primeira verificação
  setTimeout(() => verificarNovidades(), 5000);
  
  // Verificações periódicas
  setInterval(verificarNovidades, intervalo);
});

// ============================================
// TRATAMENTO DE ERROS
// ============================================

client.on('error', (erro) => {
  console.error('❌ Erro no cliente Discord:', erro.message);
});

process.on('unhandledRejection', (erro) => {
  console.error('❌ Erro não tratado:', erro);
});

// ============================================
// INICIAR O BOT
// ============================================

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ ERRO: Token não encontrado no arquivo .env');
  process.exit(1);
}

client.login(token);