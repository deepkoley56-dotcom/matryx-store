# MATRYX STORE — Ready-to-run

A real Node.js + Express + PostgreSQL store with:
- Customer product store
- Cart and checkout
- UPI deep-link payment
- WhatsApp order handoff
- Admin login
- Product add/edit/delete/stock
- Order dashboard and status updates
- PostgreSQL persistence
- Render-friendly deployment

## 1. Install

```bash
npm install
```

## 2. Configure

Copy `.env.example` to `.env` and change:

- `DATABASE_URL`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `UPI_ID`
- `WHATSAPP_NUMBER`

`WHATSAPP_NUMBER` should be the country code + number, e.g. `919876543210` (no `+`, spaces, or dashes).

## 3. Run

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Admin is available from the `ADMIN` button.

## Render deployment

Create a PostgreSQL database on Render, then create a Web Service from this project.

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Add environment variables in Render:

```text
DATABASE_URL=<Render PostgreSQL internal/external connection string>
ADMIN_USERNAME=<your admin username>
ADMIN_PASSWORD=<strong admin password>
UPI_ID=<your UPI ID>
WHATSAPP_NUMBER=<your WhatsApp number with country code>
STORE_NAME=MATRYX STORE
CURRENCY=INR
```

Do not commit `.env` to GitHub.

## Important payment note

This version creates an order and opens the customer's UPI app using a UPI deep link. The admin manually verifies the transaction ID/payment in the dashboard.

It does not claim automatic payment verification. Automatic verification requires a payment gateway/merchant integration and its own merchant account/API credentials.
