# Gemini no Chatbook

Esta integracao e opcional e segura: a chave do Gemini fica apenas no Google Apps Script, nunca no GitHub Pages.

## Como ativar

1. Abra o projeto do Google Apps Script do sistema.
2. Atualize o arquivo `Code.gs` com a versao deste repositorio.
3. No Apps Script, va em **Configuracoes do projeto**.
4. Em **Propriedades do script**, crie:
   - `GEMINI_API_KEY`
   - valor: sua chave do Google AI Studio
5. Publique uma nova implantacao do Apps Script.

## O que a IA faz

- Reescreve mensagens do assistente para ficarem mais claras, naturais e institucionais.
- Mantem a logica do formulario intacta.
- Nao altera numeros, turmas, turnos, capacidades nem respostas.

## Se nao configurar a chave

O sistema continua funcionando normalmente com os textos padrao.
