# Yalla Stock

The stock and sales tracker for Yalla Wear. You and Zohrab log in from your phones, see live stock for every product (hoodies, t-shirts, shorts, anything), log each sale and send the client a branded receipt.

## What it does

- **Products.** Add as many products as you want. Each one has its own price, colors, sizes, stock grid, and whether it can be printed on (with its own front and front + back print prices). There are quick-add buttons for common colors and sizes, and you can add custom ones. You can rename, add or remove anything at any time.
  - Removing a product, color or size only hides it. Old sales and receipts keep their original names and prices, and you can restore it later from Settings.
- **Stock page.** Product tabs across the top, each with a live color × size grid. A box turns red when 1 or fewer are left and yellow at 6 or more ("push sales"). Tap a box to sell it or fix the count. There's also Restock and a full history.
- **New sale.** Pick product, color, size, print and quantity. You can put several products in one sale and change the price per line (for wholesale), add a discount, mark it paid or not paid, and add a note.
- **Client contact.** One box for a phone number or an Instagram @username, and the app recognizes which one it is. Clients you've sold to before are suggested and their contact fills in.
- **Sending the receipt.** After saving there's one button:
  - **WhatsApp** opens the chat with a message and a private receipt link (the receipt image shows as a preview).
  - **Instagram** copies the message and opens the DM, so you just paste it. Instagram doesn't let apps pre-fill DMs.
  - **Share PDF / Download** are always there too.
- **Receipt link.** A branded page where the client can see and download the PDF. Links are long random codes and are hidden from Google.
- **Sales log.** Search by client, @instagram or product, filter by not paid or cancelled, mark as paid, or cancel (the stock goes back). You can export to Excel (CSV).
- **Alerts.** A stock check shows when you open the app, plus a notice after every sale when something is running out or there are too many.
- **Two phones.** Stock syncs between you and Zohrab every 15 seconds, and right away when you reopen the app.
- **Settings.** Products (edit or restore), alert levels, shop phone and Instagram for the receipt, a custom logo, and **Download backup**.

The first run loads the Hoodies sheet as the opening stock (76 pieces).

## Run locally

```bash
npm install
USERS="zaven:pass1,zohrab:pass2" npm start   # http://localhost:3000
```

## Deploy with Coolify (Hostinger VPS)

1. Push this folder to a Git repo and add it in Coolify as a **Dockerfile** app. Port is `3000`.
2. Set the environment variable `USERS=zaven:STRONG_PASS,zohrab:STRONG_PASS`. Until you do, the app shows a warning and uses test passwords.
3. Add a **persistent volume** mounted at `/data`. The database and the receipts live there. Without it, every redeploy wipes everything.
4. Add a domain, for example `stock.yourdomain.com`, and turn on HTTPS. The secure login cookie and the WhatsApp link preview turn on automatically over HTTPS.
5. On each phone, open the site, then use **Add to Home Screen** (iPhone: Share → Add to Home Screen; Android: ⋮ → Install app).

## Security

- Logins are limited to 8 wrong tries per 15 minutes per device.
- Sessions last 30 days and use HttpOnly cookies, which are also Secure on HTTPS.

## Backups

Use **Settings → Download backup** every week or so. It downloads the full database, with all products, stock and sales. Everything else lives in `/data` (`yalla.db` plus `receipts/`). Back up that folder if you snapshot the server.
