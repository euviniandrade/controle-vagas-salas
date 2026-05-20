# Publicação no GitHub Pages

Este app pode rodar no GitHub Pages como site estático.

Arquivos necessários na raiz do repositório:

- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `.nojekyll`
- pasta `assets/`

O banco continua sendo o Google Apps Script/Google Sheets configurado em `config.js`.

## Ativar Pages

No GitHub:

1. Abra o repositório.
2. Vá em **Settings > Pages**.
3. Em **Build and deployment**, escolha:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
4. Clique em **Save**.

Depois de alguns minutos, o site fica disponível em:

```text
https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/
```
