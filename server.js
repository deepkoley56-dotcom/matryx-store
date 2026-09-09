require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true"
    ? { rejectUnauthorized: false }
    : false
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const adminTokens = new Map();

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
      image TEXT DEFAULT '',
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
  `);

  const count = await pool.query("SELECT COUNT(*)::int AS n FROM products");
  if (count.rows[0].n === 0) {
    await pool.query(
      `INSERT INTO products (name,description,price,image,stock) VALUES
      ($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)`,
      [
        "MATRYX Premium Item",
        "Add your product description from the admin panel.",
        499,
        "https://placehold.co/900x650/090909/ff1b2d?text=MATRYX+ITEM",
        10,
        "MATRYX Starter Item",
        "Demo product. Edit or delete it from Admin.",
        999,
        "https://placehold.co/900x650/090909/ff1b2d?text=STARTER+ITEM",
        5
      ]
    );
  }
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token || !adminTokens.has(token)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.get("/api/config", (req,res) => {
  res.json({
    storeName: process.env.STORE_NAME || "MATRYX STORE",
    upiId: process.env.UPI_ID || "",
    whatsapp: process.env.WHATSAPP_NUMBER || "",
    currency: process.env.CURRENCY || "INR"
  });
});

app.get("/api/products", async (req,res) => {
  try {
    const r = await pool.query("SELECT * FROM products WHERE active=true ORDER BY id DESC");
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:"Database error"}); }
});

app.post("/api/admin/login", (req,res) => {
  const { username, password } = req.body;
  if (username !== (process.env.ADMIN_USERNAME || "admin") ||
      password !== (process.env.ADMIN_PASSWORD || "")) {
    return res.status(401).json({error:"Invalid admin credentials"});
  }
  const token = crypto.randomBytes(32).toString("hex");
  adminTokens.set(token, Date.now());
  res.json({token});
});

app.post("/api/admin/logout", auth, (req,res) => {
  const token = req.headers.authorization.replace(/^Bearer\s+/i,"");
  adminTokens.delete(token);
  res.json({ok:true});
});

app.get("/api/admin/products", auth, async (req,res) => {
  try {
    const r = await pool.query("SELECT * FROM products ORDER BY id DESC");
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:"Database error"}); }
});

app.post("/api/admin/products", auth, async (req,res) => {
  try {
    const {name,description,price,image,stock,active=true} = req.body;
    if (!name || Number.isNaN(Number(price))) return res.status(400).json({error:"Name and valid price required"});
    const r = await pool.query(
      `INSERT INTO products(name,description,price,image,stock,active) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name,description||"",Number(price),image||"",Math.max(0,parseInt(stock)||0),!!active]
    );
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:"Could not create product"}); }
});

app.put("/api/admin/products/:id", auth, async (req,res) => {
  try {
    const {name,description,price,image,stock,active=true} = req.body;
    const r = await pool.query(
      `UPDATE products SET name=$1,description=$2,price=$3,image=$4,stock=$5,active=$6 WHERE id=$7 RETURNING *`,
      [name,description||"",Number(price),image||"",Math.max(0,parseInt(stock)||0),!!active,req.params.id]
    );
    if (!r.rowCount) return res.status(404).json({error:"Product not found"});
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:"Could not update product"}); }
});

app.delete("/api/admin/products/:id", auth, async (req,res) => {
  try {
    await pool.query("DELETE FROM products WHERE id=$1",[req.params.id]);
    res.json({ok:true});
  } catch(e) { res.status(500).json({error:"Could not delete product"}); }
});

app.post("/api/orders", async (req,res) => {
  const {customerName,customerPhone,address,items,paymentMethod="UPI",transactionId="",notes=""} = req.body;
  if (!customerName || !customerPhone || !Array.isArray(items) || !items.length)
    return res.status(400).json({error:"Customer details and cart are required"});

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = items.map(x => Number(x.id)).filter(Boolean);
    const p = await client.query("SELECT * FROM products WHERE id = ANY($1::int[]) AND active=true FOR UPDATE",[ids]);
    const map = new Map(p.rows.map(x=>[x.id,x]));
    let subtotal=0;
    const finalItems=[];
    for (const item of items) {
      const product=map.get(Number(item.id));
      const qty=Math.max(1,parseInt(item.qty)||1);
      if (!product) throw new Error("A product is no longer available");
      if (product.stock < qty) throw new Error(`Not enough stock for ${product.name}`);
      const line=Number(product.price)*qty;
      subtotal+=line;
      finalItems.push({id:product.id,name:product.name,price:Number(product.price),qty,line});
      await client.query("UPDATE products SET stock=stock-$1 WHERE id=$2",[qty,product.id]);
    }
    const order=await client.query(
      `INSERT INTO orders(customer_name,customer_phone,customer_address,items,subtotal,payment_method,transaction_id,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,created_at`,
      [customerName,customerPhone,address||"",JSON.stringify(finalItems),subtotal,paymentMethod,transactionId||"",notes||""]
    );
    await client.query("COMMIT");
    res.json({ok:true,orderId:order.rows[0].id,subtotal,createdAt:order.rows[0].created_at});
  } catch(e) {
    await client.query("ROLLBACK");
    res.status(400).json({error:e.message || "Could not create order"});
  } finally { client.release(); }
});

app.get("/api/admin/orders", auth, async (req,res) => {
  try {
    const r=await pool.query("SELECT * FROM orders ORDER BY id DESC");
    res.json(r.rows);
  } catch(e) { res.status(500).json({error:"Database error"}); }
});

app.put("/api/admin/orders/:id", auth, async (req,res) => {
  const {paymentStatus,orderStatus}=req.body;
  try {
    const r=await pool.query(
      `UPDATE orders SET payment_status=COALESCE($1,payment_status), order_status=COALESCE($2,order_status)
       WHERE id=$3 RETURNING *`,
      [paymentStatus||null,orderStatus||null,req.params.id]
    );
    if (!r.rowCount) return res.status(404).json({error:"Order not found"});
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:"Could not update order"}); }
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

initDb()
  .then(()=>app.listen(PORT,()=>console.log(`MATRYX STORE running on port ${PORT}`)))
  .catch(err=>{console.error("Database initialization failed:",err); process.exit(1);});
