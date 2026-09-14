require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const TelegramBot = require("node-telegram-bot-api");

const app = express();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  }
});

const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  }
});
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true"
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const adminTokens = new Map();

const telegramBotToken = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const telegramAdminChatId = String(process.env.TELEGRAM_ADMIN_CHAT_ID || "").trim();
let telegramBot = null;

if (telegramBotToken && telegramAdminChatId) {
  telegramBot = new TelegramBot(telegramBotToken, { polling: true });
  telegramBot.on("polling_error", err => {
    console.error("TELEGRAM POLLING ERROR:", err.message);
  });
}

function telegramCaption(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemLines = items.map(i =>
    `• ${i.name}${i.plan ? ` [${i.plan}]` : ""} × ${i.qty} — ₹${Number(i.line || 0).toFixed(2)}`
  ).join("\n");

  return [
    `🛒 MATRYX STORE — ORDER #${order.id}`,
    "",
    itemLines || "• No items",
    "",
    `Total: ₹${Number(order.subtotal || 0).toFixed(2)}`,
    `Name: ${order.customer_name}`,
    `Phone: ${order.customer_phone}`,
    `UPI Transaction ID: ${order.transaction_id || "Not provided"}`,
    `Payment: ${order.payment_status}`,
    `Order: ${order.order_status}`,
    "",
    "Check the payment manually, then press CONFIRM to deliver the selected-plan key."
  ].join("\n");
}

async function notifyTelegramOrder(orderId) {
  if (!telegramBot) return;

  try {
    const r = await pool.query("SELECT * FROM orders WHERE id=$1 LIMIT 1", [orderId]);
    if (!r.rowCount) return;
    const order = r.rows[0];
    const caption = telegramCaption(order);
    const keyboard = {
      inline_keyboard: [[
        { text: "✅ CONFIRM PAYMENT & DELIVER KEY", callback_data: `deliver:${order.id}` }
      ]]
    };

    if (order.payment_screenshot) {
      await telegramBot.sendPhoto(telegramAdminChatId, order.payment_screenshot, {
        caption,
        reply_markup: keyboard
      });
    } else {
      await telegramBot.sendMessage(telegramAdminChatId, caption, {
        reply_markup: keyboard
      });
    }
  } catch (e) {
    console.error("TELEGRAM ORDER NOTIFY ERROR:", e.message);
  }
}

async function deliverOrderKey(orderId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderR = await client.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [orderId]);
    if (!orderR.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "Order not found" };
    }

    const order = orderR.rows[0];
    if (order.delivery_key) {
      await client.query("COMMIT");
      return { ok: true, alreadyDelivered: true, deliveryKey: order.delivery_key, order };
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const item = items.find(i => i.plan);
    if (!item) {
      await client.query("ROLLBACK");
      return { ok: false, status: 400, error: "This order has no selected plan." };
    }

    const planName = String(item.plan);
    const keyR = await client.query(
      `SELECT id, delivery_key FROM key_inventory
       WHERE used=false AND lower(plan_name)=lower($1)
       ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [planName]
    );

    if (!keyR.rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: `No unused key available for ${planName}` };
    }

    const key = keyR.rows[0];
    const minutes = /hour/i.test(planName)
      ? 60
      : /day/i.test(planName)
        ? (Number(planName.match(/\d+(?:\.\d+)?/)?.[0] || 1) * 1440)
        : null;
    const expiry = minutes ? new Date(Date.now() + minutes * 60000) : null;

    await client.query(
      `UPDATE key_inventory SET used=true, used_order_id=$1, used_at=NOW() WHERE id=$2`,
      [orderId, key.id]
    );

    const updated = await client.query(
      `UPDATE orders
       SET payment_status='PAID', delivery_key=$1, delivery_expires_at=$2, order_status='DELIVERED'
       WHERE id=$3 RETURNING *`,
      [key.delivery_key, expiry, orderId]
    );

    await client.query("COMMIT");
    return { ok: true, deliveryKey: key.delivery_key, order: updated.rows[0] };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

if (telegramBot) {
  telegramBot.on("callback_query", async query => {
    const chatId = String(query.message?.chat?.id || "");
    if (chatId !== telegramAdminChatId) {
      await telegramBot.answerCallbackQuery(query.id, { text: "Unauthorized", show_alert: true }).catch(() => {});
      return;
    }

    const data = String(query.data || "");
    if (!data.startsWith("deliver:")) return;
    const orderId = Number(data.slice("deliver:".length));
    if (!Number.isInteger(orderId) || orderId <= 0) {
      await telegramBot.answerCallbackQuery(query.id, { text: "Invalid order", show_alert: true }).catch(() => {});
      return;
    }

    try {
      const result = await deliverOrderKey(orderId);
      if (!result.ok) {
        await telegramBot.answerCallbackQuery(query.id, { text: result.error, show_alert: true }).catch(() => {});
        return;
      }

      const keyText = result.deliveryKey || result.order?.delivery_key || "Already delivered";
      await telegramBot.answerCallbackQuery(query.id, { text: "Payment confirmed + key delivered" }).catch(() => {});
      if (query.message) {
        const updatedCaption = `${query.message.caption || query.message.text || ""}\n\n✅ DELIVERED\n🔑 Key: ${keyText}`;
        const edit = {
          chat_id: telegramAdminChatId,
          message_id: query.message.message_id,
          reply_markup: { inline_keyboard: [] }
        };
        if (query.message.photo) {
          edit.caption = updatedCaption;
          await telegramBot.editMessageCaption(updatedCaption, edit).catch(async () => {
            await telegramBot.editMessageReplyMarkup(edit.reply_markup, { chat_id: telegramAdminChatId, message_id: query.message.message_id }).catch(() => {});
          });
        } else {
          await telegramBot.editMessageText(updatedCaption, { chat_id: telegramAdminChatId, message_id: query.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
        }
      }
    } catch (e) {
      console.error("TELEGRAM DELIVERY ERROR:", e);
      await telegramBot.answerCallbackQuery(query.id, { text: "Delivery failed", show_alert: true }).catch(() => {});
    }
  });
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
      image TEXT DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      video TEXT DEFAULT '',
      plans JSONB NOT NULL DEFAULT '[]'::jsonb,
      tag TEXT DEFAULT '',
      features TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      store_open BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    INSERT INTO store_settings (id, store_open)
    VALUES (1, TRUE)
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_address TEXT DEFAULT '',
      items JSONB NOT NULL,
      subtotal NUMERIC(12,2) NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'UPI',
      payment_status TEXT NOT NULL DEFAULT 'PENDING',
      order_status TEXT NOT NULL DEFAULT 'PENDING',
      transaction_id TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS video TEXT DEFAULT '';

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS plans JSONB NOT NULL DEFAULT '[]'::jsonb;

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS tag TEXT DEFAULT '';

    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS features TEXT DEFAULT '';

    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_key TEXT DEFAULT '';

    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_expires_at TIMESTAMPTZ;

    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_screenshot TEXT DEFAULT '';

    CREATE TABLE IF NOT EXISTS key_inventory (
      id SERIAL PRIMARY KEY,
      plan_name TEXT NOT NULL,
      delivery_key TEXT NOT NULL UNIQUE,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      used_order_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ
    );
  `);

  const count = await pool.query(
    "SELECT COUNT(*)::int AS n FROM products"
  );

  if (count.rows[0].n === 0) {
    await pool.query(
      `INSERT INTO products
       (name, description, price, image, stock, video, plans)
       VALUES
       ($1,$2,$3,$4,$5,$6,$7),
       ($8,$9,$10,$11,$12,$13,$14)`,
      [
        "MATRYX Premium Item",
        "Add your product description from the admin panel.",
        499,
        "https://placehold.co/900x650/090909/ff1b2d?text=MATRYX+ITEM",
        10,
        "",
        JSON.stringify([
          { name: "1 Hour", price: 50 },
          { name: "1 Day", price: 100 }
        ]),

        "MATRYX Starter Item",
        "Demo product. Edit or delete it from Admin.",
        999,
        "https://placehold.co/900x650/090909/ff1b2d?text=STARTER+ITEM",
        5,
        "",
        JSON.stringify([
          { name: "1 Hour", price: 50 },
          { name: "1 Day", price: 100 }
        ])
      ]
    );
  }
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");

  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function cleanPlans(plans) {
  if (!Array.isArray(plans)) return [];

  return plans
    .map(p => ({
      name: String(p.name || "").trim(),
      price: Number(p.price)
    }))
    .filter(
      p =>
        p.name &&
        Number.isFinite(p.price) &&
        p.price >= 0
    );
}

app.get("/api/config", async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT store_open FROM store_settings WHERE id=1"
    );

    res.json({
      storeName: process.env.STORE_NAME || "MATRYX STORE",
      upiId: process.env.UPI_ID || "",
      whatsapp: process.env.WHATSAPP_NUMBER || "",
      currency: process.env.CURRENCY || "INR",
      storeOpen: r.rows[0]?.store_open !== false
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/admin/store-status", auth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT store_open FROM store_settings WHERE id=1"
    );
    res.json({ storeOpen: r.rows[0]?.store_open !== false });
  } catch (e) {
    res.status(500).json({ error: "Database error" });
  }
});

app.put("/api/admin/store-status", auth, async (req, res) => {
  try {
    const storeOpen = req.body.storeOpen !== false;
    const r = await pool.query(
      `INSERT INTO store_settings (id, store_open, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id)
       DO UPDATE SET store_open=EXCLUDED.store_open, updated_at=NOW()
       RETURNING store_open`,
      [storeOpen]
    );
    res.json({ ok: true, storeOpen: r.rows[0].store_open });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not update store status" });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM products ORDER BY id DESC"
    );

    res.json(r.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (
    username !== (process.env.ADMIN_USERNAME || "admin") ||
    password !== (process.env.ADMIN_PASSWORD || "")
  ) {
    return res.status(401).json({
      error: "Invalid admin credentials"
    });
  }

  const token = crypto.randomBytes(32).toString("hex");

  adminTokens.set(token, Date.now());

  res.json({ token });
});

app.post("/api/admin/logout", auth, (req, res) => {
  const token = req.headers.authorization.replace(
    /^Bearer\s+/i,
    ""
  );

  adminTokens.delete(token);

  res.json({ ok: true });
});

app.post(
  "/api/admin/upload-video",
  auth,
  upload.single("video"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: "No video selected"
        });
      }

      const result = await new Promise((resolve, reject) => {
        const stream =
          cloudinary.uploader.upload_stream(
            {
              resource_type: "video",
              folder: "matryx-store/videos"
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );

        stream.end(req.file.buffer);
      });

      res.json({
        ok: true,
        url: result.secure_url,
        publicId: result.public_id,
        duration: result.duration || 0,
        bytes: result.bytes || 0
      });

    } catch (e) {
      console.error("VIDEO UPLOAD ERROR:", e);

      res.status(500).json({
        error: e.message || "Video upload failed"
      });
    }
  }
);

app.get("/api/admin/products", auth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM products ORDER BY id DESC"
    );

    res.json(r.rows);
  } catch (e) {
    res.status(500).json({
      error: "Database error"
    });
  }
});

app.post("/api/admin/products", auth, async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      image,
      stock,
      video,
      plans,
      active = true,
      tag = "",
      features = ""
    } = req.body;

    const cleanedPlans = cleanPlans(plans);

    if (!name) {
      return res.status(400).json({
        error: "Product name required"
      });
    }

    const fallbackPrice = cleanedPlans.length
      ? cleanedPlans[0].price
      : Number(price) || 0;

    const r = await pool.query(
      `INSERT INTO products
       (name, description, price, image, stock, video, plans, active, tag, features)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        name,
        description || "",
        fallbackPrice,
        image || "",
        Math.max(0, parseInt(stock) || 0),
        video || "",
        JSON.stringify(cleanedPlans),
        !!active,
        String(tag || "").trim(),
        String(features || "").trim()
      ]
    );

    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: "Could not create product"
    });
  }
});

app.put("/api/admin/products/:id", auth, async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      image,
      stock,
      video,
      plans,
      active = true,
      tag = "",
      features = ""
    } = req.body;

    const cleanedPlans = cleanPlans(plans);

    if (!name) {
      return res.status(400).json({
        error: "Product name required"
      });
    }

    const fallbackPrice = cleanedPlans.length
      ? cleanedPlans[0].price
      : Number(price) || 0;

    const r = await pool.query(
      `UPDATE products
       SET name=$1,
           description=$2,
           price=$3,
           image=$4,
           stock=$5,
           video=$6,
           plans=$7,
           active=$8,
           tag=$9,
           features=$10
       WHERE id=$11
       RETURNING *`,
      [
        name,
        description || "",
        fallbackPrice,
        image || "",
        Math.max(0, parseInt(stock) || 0),
        video || "",
        JSON.stringify(cleanedPlans),
        !!active,
        String(tag || "").trim(),
        String(features || "").trim(),
        req.params.id
      ]
    );

    if (!r.rowCount) {
      return res.status(404).json({
        error: "Product not found"
      });
    }

    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: "Could not update product"
    });
  }
});

app.delete("/api/admin/products/:id", auth, async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM products WHERE id=$1",
      [req.params.id]
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({
      error: "Could not delete product"
    });
  }
});

app.post("/api/payment-screenshot", screenshotUpload.single("screenshot"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Payment screenshot is required" });
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({ error: "Cloudinary is not configured" });
    }

    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "matryx-store/payment-screenshots",
          resource_type: "image"
        },
        (error, uploaded) => error ? reject(error) : resolve(uploaded)
      );
      stream.end(req.file.buffer);
    });

    res.json({ ok: true, url: result.secure_url });
  } catch (e) {
    console.error("PAYMENT SCREENSHOT ERROR:", e);
    res.status(500).json({ error: "Could not upload payment screenshot" });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const storeCheck = await pool.query(
      "SELECT store_open FROM store_settings WHERE id=1"
    );
    if (storeCheck.rows[0] && storeCheck.rows[0].store_open === false) {
      return res.status(403).json({ error: "Store is currently offline" });
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Could not check store status" });
  }

  const {
    customerName,
    customerPhone,
    address,
    items,
    paymentMethod = "UPI",
    transactionId = "",
    notes = "",
    paymentScreenshot = ""
  } = req.body;

  if (
    !customerName ||
    !customerPhone ||
    !Array.isArray(items) ||
    !items.length
  ) {
    return res.status(400).json({
      error: "Customer details and cart are required"
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const ids = items
      .map(x => Number(x.id))
      .filter(Boolean);

    const p = await client.query(
      `SELECT * FROM products
       WHERE id=ANY($1::int[])
       AND active=true
       FOR UPDATE`,
      [ids]
    );

    const map = new Map(
      p.rows.map(x => [x.id, x])
    );

    let subtotal = 0;
    const finalItems = [];

    for (const item of items) {
      const product = map.get(Number(item.id));
      const qty = Math.max(
        1,
        parseInt(item.qty) || 1
      );

      if (!product) {
        throw new Error(
          "A product is no longer available"
        );
      }

      if (product.stock < qty) {
        throw new Error(
          `Not enough stock for ${product.name}`
        );
      }

      const plans = Array.isArray(product.plans)
        ? product.plans
        : [];

      let selectedPlan = null;

      if (item.planName) {
        selectedPlan = plans.find(
          p =>
            String(p.name) ===
            String(item.planName)
        );

        if (!selectedPlan) {
          throw new Error(
            `Selected plan is no longer available for ${product.name}`
          );
        }
      }

      const unitPrice = selectedPlan
        ? Number(selectedPlan.price)
        : Number(product.price);

      const line = unitPrice * qty;

      subtotal += line;

      finalItems.push({
        id: product.id,
        name: product.name,
        plan: selectedPlan?.name || "",
        price: unitPrice,
        qty,
        line
      });

      await client.query(
        "UPDATE products SET stock=stock-$1 WHERE id=$2",
        [qty, product.id]
      );
    }

    const order = await client.query(
      `INSERT INTO orders
       (customer_name, customer_phone, customer_address,
        items, subtotal, payment_method, transaction_id, notes, payment_screenshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, created_at`,
      [
        customerName,
        customerPhone,
        address || "",
        JSON.stringify(finalItems),
        subtotal,
        paymentMethod,
        transactionId || "",
        notes || "",
        paymentScreenshot || ""
      ]
    );

    await client.query("COMMIT");

    const createdOrderId = order.rows[0].id;
    notifyTelegramOrder(createdOrderId);

    res.json({
      ok: true,
      orderId: createdOrderId,
      subtotal,
      createdAt: order.rows[0].created_at
    });

  } catch (e) {
    await client.query("ROLLBACK");

    res.status(400).json({
      error: e.message ||
        "Could not create order"
    });

  } finally {
    client.release();
  }
});

app.get("/api/admin/orders", auth, async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT * FROM orders ORDER BY id DESC"
    );

    res.json(r.rows);
  } catch (e) {
    res.status(500).json({
      error: "Database error"
    });
  }
});

app.put("/api/admin/orders/:id", auth, async (req, res) => {
  const {
    paymentStatus,
    orderStatus,
    deliveryKey,
    durationMinutes,
    durationValue,
    durationUnit
  } = req.body;

  try {
    let expiry = null;
    let finalMinutes = null;

    if (
      durationValue !== undefined &&
      durationValue !== null &&
      durationValue !== ""
    ) {
      const value = Number(durationValue);
      const unit = String(durationUnit || "").toLowerCase();

      if (!Number.isFinite(value) || value <= 0) {
        return res.status(400).json({
          error: "Invalid delivery time"
        });
      }

      if (unit === "minutes") {
        finalMinutes = value;
      } else if (unit === "hours") {
        finalMinutes = value * 60;
      } else if (unit === "days") {
        finalMinutes = value * 1440;
      } else {
        return res.status(400).json({
          error: "Invalid delivery unit"
        });
      }
    } else if (
      durationMinutes !== undefined &&
      durationMinutes !== null &&
      durationMinutes !== ""
    ) {
      finalMinutes = Number(durationMinutes);

      if (!Number.isFinite(finalMinutes) || finalMinutes <= 0) {
        return res.status(400).json({
          error: "Invalid delivery duration"
        });
      }
    }

    if (finalMinutes !== null) {
      expiry = new Date(
        Date.now() + finalMinutes * 60 * 1000
      );
    }

    const hasDeliveryUpdate =
      deliveryKey !== undefined ||
      finalMinutes !== null;

    const r = await pool.query(
      `UPDATE orders
       SET payment_status=COALESCE($1,payment_status),
           order_status=COALESCE($2,order_status),
           delivery_key=CASE
             WHEN $4::boolean THEN $3
             ELSE delivery_key
           END,
           delivery_expires_at=CASE
             WHEN $4::boolean THEN $5::timestamptz
             ELSE delivery_expires_at
           END
       WHERE id=$6
       RETURNING *`,
      [
        paymentStatus || null,
        orderStatus || null,
        deliveryKey !== undefined
          ? String(deliveryKey)
          : "",
        hasDeliveryUpdate,
        expiry,
        req.params.id
      ]
    );

    if (!r.rowCount) {
      return res.status(404).json({
        error: "Order not found"
      });
    }

    res.json(r.rows[0]);

  } catch (e) {
    console.error("ORDER UPDATE ERROR:", e);

    res.status(500).json({
      error: "Could not update order"
    });
  }
});


app.get("/api/admin/keys", auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT plan_name, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE used=false)::int AS available
       FROM key_inventory GROUP BY plan_name ORDER BY plan_name`
    );
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/admin/keys", auth, async (req, res) => {
  const planName = String(req.body.planName || "").trim();
  const keys = Array.isArray(req.body.keys) ? req.body.keys : [];
  if (!planName || !keys.length) return res.status(400).json({ error: "Plan and keys are required" });
  try {
    let added = 0;
    for (const raw of keys) {
      const key = String(raw || "").trim();
      if (!key) continue;
      const r = await pool.query(
        `INSERT INTO key_inventory (plan_name, delivery_key) VALUES ($1,$2) ON CONFLICT (delivery_key) DO NOTHING`,
        [planName, key]
      );
      added += r.rowCount;
    }
    res.json({ ok: true, added });
  } catch (e) {
    console.error("KEY ADD ERROR:", e);
    res.status(500).json({ error: "Could not add keys" });
  }
});

app.post("/api/admin/orders/:id/deliver-key", auth, async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ error: "Invalid order ID" });
  }

  try {
    const result = await deliverOrderKey(orderId);
    if (!result.ok) return res.status(result.status || 500).json({ error: result.error });
    res.json(result);
  } catch (e) {
    console.error("AUTO DELIVERY ERROR:", e);
    res.status(500).json({ error: "Could not deliver key" });
  }
});

app.post("/api/order-history", async (req, res) => {
  const {
    orderId,
    phone
  } = req.body;

  if (!orderId || !phone) {
    return res.status(400).json({
      error: "Order ID and phone number are required"
    });
  }

  try {
    const r = await pool.query(
      `SELECT
        id,
        customer_name,
        customer_phone,
        items,
        subtotal,
        payment_method,
        payment_status,
        order_status,
        transaction_id,
        delivery_key,
        delivery_expires_at,
        created_at
       FROM orders
       WHERE id = $1
       AND customer_phone = $2
       LIMIT 1`,
      [
        Number(orderId),
        String(phone).trim()
      ]
    );

    if (!r.rowCount) {
      return res.status(404).json({
        error: "Order not found"
      });
    }

    const order = r.rows[0];

    res.json(order);

  } catch (e) {
    console.error("ORDER HISTORY ERROR:", e);

    res.status(500).json({
      error: "Could not load order"
    });
  }
});


app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

initDb()
  .then(() => {
    app.listen(
      PORT,
      () =>
        console.log(
          `MATRYX STORE running on port ${PORT}`
        )
    );
  })
  .catch(err => {
    console.error(
      "Database initialization failed:",
      err
    );

    process.exit(1);
  });
