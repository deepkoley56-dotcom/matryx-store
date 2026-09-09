let products = [];
let cart = JSON.parse(
  localStorage.getItem("matryx_cart") || "[]"
);
let config = {};
let adminToken =
  localStorage.getItem("matryx_admin") || "";

const $ = id => document.getElementById(id);

const money = n =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: config.currency || "INR"
  }).format(Number(n) || 0);

async function api(url, opt = {}) {
  const r = await fetch(url, {
    ...opt,
    headers: {
      "Content-Type": "application/json",
      ...(opt.headers || {})
    }
  });

  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(
      data.error || "Request failed"
    );
  }

  return data;
}

function saveCart() {
  localStorage.setItem(
    "matryx_cart",
    JSON.stringify(cart)
  );

  updateCount();
}

function updateCount() {
  $("cartCount").textContent =
    cart.reduce(
      (a, x) => a + x.qty,
      0
    );
}

function hideViews() {
  [
    "shopView",
    "cartView",
    "adminView"
  ].forEach(x =>
    $(x).classList.add("hidden")
  );
}

function showShop() {
  hideViews();
  $("shopView").classList.remove("hidden");
}

function openCart() {
  hideViews();
  $("cartView").classList.remove("hidden");
  renderCart();
}

function openAdmin() {
  hideViews();
  $("adminView").classList.remove("hidden");

  if (adminToken) {
    loadDashboard();
  }
}

async function load() {
  config = await api("/api/config");

  $("storeName").textContent =
    config.storeName || "MATRYX STORE";

  $("upiText").textContent =
    config.upiId || "Not configured";

  products = await api("/api/products");

  renderProducts();
  updateCount();
}

function productPlans(p) {
  return Array.isArray(p.plans)
    ? p.plans
    : [];
}

function renderProducts() {
  $("products").innerHTML =
    products.map(p => {

      const plans = productPlans(p);

      const mediaHTML = p.video
        ? `
          <div class="productVideo">
            <video
              src="${escAttr(p.video)}"
              controls
              playsinline
              preload="metadata"
            ></video>
          </div>
        `
        : `
          <img
            src="${escAttr(
              p.image ||
              "https://placehold.co/900x650/090909/ff1b2d?text=MATRYX"
            )}"
            onerror="this.src='https://placehold.co/900x650/090909/ff1b2d?text=MATRYX'"
          >
        `;

      const planHTML = plans.length
        ? `
          <div class="planTitle">
            SELECT PLAN
          </div>

          <div class="plans">
            ${plans.map((plan, i) => `
              <button
                type="button"
                class="planBtn ${i === 0 ? "selected" : ""}"
                data-plan-index="${i}"
                onclick="selectPlan(this, ${p.id}, ${i})"
              >
                <span>${esc(plan.name)}</span>
                <b>${money(plan.price)}</b>
              </button>
            `).join("")}
          </div>
        `
        : `
          <div class="price">
            ${money(p.price)}
          </div>
        `;

      return `
        <article
          class="card"
          data-product-id="${p.id}"
          data-selected-plan="0"
        >

          ${mediaHTML}

          <div class="cardBody">

            <h3>
              ${esc(p.name)}
            </h3>

            <p class="muted">
              ${esc(p.description || "")}
            </p>

            ${planHTML}

            <p class="muted">
              Stock: ${p.stock}
            </p>

            <button
              class="primary"
              ${p.stock < 1 ? "disabled" : ""}
              onclick="addCart(${p.id})"
            >
              ${
                p.stock < 1
                  ? "OUT OF STOCK"
                  : "ADD TO CART"
              }
            </button>

          </div>
        </article>
      `;
    }).join("");
}

function selectPlan(btn, id, index) {
  const card =
    btn.closest(".card");

  if (!card) return;

  card
    .querySelectorAll(".planBtn")
    .forEach(x =>
      x.classList.remove("selected")
    );

  btn.classList.add("selected");

  card.dataset.selectedPlan =
    String(index);
}

function getSelectedPlan(id) {
  const card = document.querySelector(
    `.card[data-product-id="${id}"]`
  );

  const p = products.find(
    x => x.id === id
  );

  if (!card || !p) {
    return null;
  }

  const plans = productPlans(p);

  if (!plans.length) {
    return null;
  }

  const index = Number(
    card.dataset.selectedPlan || 0
  );

  return plans[index] || plans[0];
}

function addCart(id) {
  const p = products.find(
    x => x.id === id
  );

  if (!p) return;

  const plan =
    getSelectedPlan(id);

  const key = plan
    ? `${id}_${plan.name}`
    : `${id}_default`;

  let x = cart.find(
    item => item.key === key
  );

  if (x) {
    x.qty = Math.min(
      x.qty + 1,
      p.stock
    );
  } else {
    cart.push({
      key,
      id,
      qty: 1,
      planName:
        plan?.name || "",
      planPrice:
        plan
          ? Number(plan.price)
          : Number(p.price)
    });
  }

  saveCart();
  openCart();
}

function renderCart() {
  if (!cart.length) {
    $("cartItems").innerHTML =
      "<div class='checkout'><p>Your cart is empty.</p></div>";

    $("cartTotal").textContent =
      money(0);

    return;
  }

  let total = 0;

  $("cartItems").innerHTML =
    cart.map((x, index) => {

      const p = products.find(
        p => p.id === x.id
      );

      if (!p) return "";

      const unit = Number(
        x.planPrice ??
        p.price
      );

      const line =
        unit * x.qty;

      total += line;

      return `
        <div class="cartRow">

          <div>

            <strong>
              ${esc(p.name)}
            </strong>

            ${
              x.planName
                ? `
                  <div class="planCart">
                    Plan:
                    <b>
                      ${esc(x.planName)}
                    </b>
                  </div>
                `
                : ""
            }

            <div class="muted">
              ${money(unit)}
              × ${x.qty}
            </div>

            <div>
              <b>
                ${money(line)}
              </b>
            </div>

          </div>

          <div class="qty">

            <button
              onclick="changeQty(${index},-1)"
            >
              −
            </button>

            <b>
              ${x.qty}
            </b>

            <button
              onclick="changeQty(${index},1)"
            >
              +
            </button>

            <button
              onclick="removeCart(${index})"
            >
              ✕
            </button>

          </div>

        </div>
      `;
    }).join("");

  $("cartTotal").textContent =
    money(total);
}

function changeQty(index, d) {
  const x = cart[index];

  if (!x) return;

  const p = products.find(
    p => p.id === x.id
  );

  if (!p) return;

  x.qty += d;

  if (x.qty <= 0) {
    cart.splice(index, 1);
  } else {
    x.qty = Math.min(
      x.qty,
      p.stock
    );
  }

  saveCart();
  renderCart();
}

function removeCart(index) {
  cart.splice(index, 1);

  saveCart();
  renderCart();
}

function payUPI() {
  if (!config.upiId) {
    alert(
      "Admin has not configured UPI ID yet."
    );
    return;
  }

  if (!cart.length) {
    alert("Cart is empty.");
    return;
  }

  const total = cart.reduce(
    (s, x) =>
      s +
      Number(
        x.planPrice || 0
      ) * x.qty,
    0
  );

  const uri =
    `upi://pay?pa=${encodeURIComponent(
      config.upiId
    )}` +
    `&pn=${encodeURIComponent(
      config.storeName
    )}` +
    `&am=${total.toFixed(2)}` +
    `&cu=INR`;

  location.href = uri;
}

async function placeOrder() {
  if (!cart.length) {
    return alert(
      "Cart is empty."
    );
  }

  const customerName =
    $("cName").value.trim();

  const customerPhone =
    $("cPhone").value.trim();

  if (
    !customerName ||
    !customerPhone
  ) {
    return alert(
      "Enter your name and phone."
    );
  }

  const items = cart.map(x => ({
    id: x.id,
    qty: x.qty,
    planName:
      x.planName || ""
  }));

  try {
    const r = await api(
      "/api/orders",
      {
        method: "POST",
        body: JSON.stringify({
          customerName,
          customerPhone,
          address:
            $("cAddress").value.trim(),
          items,
          paymentMethod: "UPI",
          transactionId:
            $("cTxn").value.trim(),
          notes:
            $("cNotes").value.trim()
        })
      }
    );

    const lines =
      cart.map(x => {

        const p =
          products.find(
            p => p.id === x.id
          );

        const unit = Number(
          x.planPrice ??
          p.price
        );

        return (
          `${p.name}` +
          (
            x.planName
              ? ` [${x.planName}]`
              : ""
          ) +
          ` x ${x.qty} = ` +
          money(unit * x.qty)
        );

      }).join("\n");

    const msg =
      `Hello ${config.storeName}, ` +
      `I want to place Order #${r.orderId}.\n\n` +
      `${lines}\n\n` +
      `Total: ${money(r.subtotal)}\n` +
      `Name: ${customerName}\n` +
      `Phone: ${customerPhone}\n` +
      `Address: ${$("cAddress").value.trim()}\n` +
      `UPI Transaction ID: ${$("cTxn").value.trim()}`;

    cart = [];

    saveCart();

    $("orderResult").innerHTML =
      `<div class="success">
        Order #${r.orderId} created successfully.
        Opening WhatsApp…
      </div>`;

    renderCart();

    if (config.whatsapp) {
      setTimeout(() => {
        location.href =
          `https://wa.me/${
            config.whatsapp.replace(
              /\D/g,
              ""
            )
          }?text=${
            encodeURIComponent(msg)
          }`;
      }, 500);
    }

  } catch (e) {
    alert(e.message);
  }
}

async function adminLogin() {
  try {
    const r = await api(
      "/api/admin/login",
      {
        method: "POST",
        body: JSON.stringify({
          username:
            $("aUser").value,
          password:
            $("aPass").value
        })
      }
    );

    adminToken = r.token;

    localStorage.setItem(
      "matryx_admin",
      adminToken
    );

    loadDashboard();

  } catch (e) {
    $("adminMsg").textContent =
      e.message;
  }
}

async function loadDashboard() {
  $("adminLogin")
    .classList.add("hidden");

  $("dashboard")
    .classList.remove("hidden");

  adminTab("products");
}

function adminTab(tab) {
  if (tab === "products") {
    $("productAdmin")
      .classList.remove("hidden");

    $("orderAdmin")
      .classList.add("hidden");

    loadAdminProducts();

  } else {
    $("productAdmin")
      .classList.add("hidden");

    $("orderAdmin")
      .classList.remove("hidden");

    loadOrders();
  }
}

function plansToText(plans) {
  if (!Array.isArray(plans)) {
    return "";
  }

  return plans
    .map(
      p =>
        `${p.name} | ${p.price}`
    )
    .join("\n");
}

function parsePlans(text) {
  return String(text || "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {

      const parts =
        line.split("|");

      return {
        name:
          (parts[0] || "")
            .trim(),

        price:
          Number(
            (parts[1] || "")
              .trim()
          )
      };
    })
    .filter(
      p =>
        p.name &&
        Number.isFinite(p.price) &&
        p.price >= 0
    );
}

async function loadAdminProducts() {
  const ps = await api(
    "/api/admin/products",
    {
      headers: {
        Authorization:
          "Bearer " + adminToken
      }
    }
  );

  $("productAdmin").innerHTML = `

    <div class="productForm">

      <h3>Add Product</h3>

      <input
        id="pn"
        placeholder="Product name"
      >

      <textarea
        id="pd"
        placeholder="Description"
      ></textarea>

      <input
        id="pi"
        placeholder="Image URL"
      >

      <input
        id="pv"
        placeholder="Video URL"
      >

      <input
        id="ps"
        type="number"
        placeholder="Stock"
      >

      <textarea
        id="plans"
        placeholder="Plans - one per line&#10;Example:&#10;1 Hour | 50&#10;1 Day | 100&#10;7 Days | 300&#10;30 Days | 500"
      ></textarea>

      <p class="planHelp">
        Format: Plan Name | Price
      </p>

      <button
        class="primary"
        onclick="createProduct()"
      >
        ADD PRODUCT
      </button>

    </div>

  ` +

  ps.map(p => `

    <div class="adminItem">

      <strong>
        ${esc(p.name)}
      </strong>

      <div class="muted">
        ${
          Array.isArray(p.plans) &&
          p.plans.length
            ? p.plans
                .map(
                  x =>
                    `${esc(x.name)} — ${money(x.price)}`
                )
                .join(" · ")
            : money(p.price)
        }
      </div>

      <div class="muted">
        Stock: ${p.stock}
        ${
          p.video
            ? " · 🎬 Video added"
            : ""
        }
      </div>

      <div class="adminActions">

        <button
          onclick='editProduct(${JSON.stringify(p)})'
        >
          EDIT
        </button>

        <button
          onclick="deleteProduct(${p.id})"
        >
          DELETE
        </button>

      </div>

    </div>

  `).join("");
}

async function createProduct() {
  const plans =
    parsePlans(
      $("plans").value
    );

  await api(
    "/api/admin/products",
    {
      method: "POST",

      headers: {
        Authorization:
          "Bearer " + adminToken
      },

      body: JSON.stringify({
        name:
          $("pn").value,

        description:
          $("pd").value,

        image:
          $("pi").value,

        video:
          $("pv").value,

        stock:
          $("ps").value,

        plans,

        price:
          plans[0]?.price || 0,

        active: true
      })
    }
  );

  await loadAdminProducts();
  await load();
}

function editProduct(p) {
  $("modalContent").innerHTML = `

    <h2>Edit Product</h2>

    <div class="productForm">

      <input
        id="en"
        value="${escAttr(p.name)}"
        placeholder="Product name"
      >

      <textarea
        id="ed"
        placeholder="Description"
      >${esc(p.description || "")}</textarea>

      <input
        id="ei"
        value="${escAttr(p.image || "")}"
        placeholder="Image URL"
      >

      <input
        id="ev"
        value="${escAttr(p.video || "")}"
        placeholder="Video URL"
      >

      <input
        id="es"
        type="number"
        value="${p.stock}"
        placeholder="Stock"
      >

      <textarea
        id="eplans"
        placeholder="1 Hour | 50&#10;1 Day | 100"
      >${esc(
        plansToText(p.plans)
      )}</textarea>

      <p class="planHelp">
        One plan per line: Plan Name | Price
      </p>

      <button
        class="primary"
        onclick="updateProduct(${p.id})"
      >
        SAVE
      </button>

    </div>

  `;

  $("modal")
    .classList.remove("hidden");
}

async function updateProduct(id) {
  const plans =
    parsePlans(
      $("eplans").value
    );

  await api(
    "/api/admin/products/" + id,
    {
      method: "PUT",

      headers: {
        Authorization:
          "Bearer " + adminToken
      },

      body: JSON.stringify({
        name:
          $("en").value,

        description:
          $("ed").value,

        image:
          $("ei").value,

        video:
          $("ev").value,

        stock:
          $("es").value,

        plans,

        price:
          plans[0]?.price || 0,

        active: true
      })
    }
  );

  closeModal();

  await loadAdminProducts();
  await load();
}

async function deleteProduct(id) {
  if (
    !confirm(
      "Delete this product?"
    )
  ) {
    return;
  }

  await api(
    "/api/admin/products/" + id,
    {
      method: "DELETE",

      headers: {
        Authorization:
          "Bearer " + adminToken
      }
    }
  );

  await loadAdminProducts();
  await load();
}

async function loadOrders() {
  const os = await api(
    "/api/admin/orders",
    {
      headers: {
        Authorization:
          "Bearer " + adminToken
      }
    }
  );

  $("orderAdmin").innerHTML =
    os.length
      ? os.map(o => `

        <div class="orderCard">

          <h3>
            Order #${o.id}
          </h3>

          <p>
            <b>
              ${esc(o.customer_name)}
            </b>
            ·
            ${esc(o.customer_phone)}
          </p>

          <p>
            ${esc(
              o.customer_address || ""
            )}
          </p>

          <p>
            ${(o.items || [])
              .map(i => `
                ${esc(i.name)}
                ${
                  i.plan
                    ? ` [${esc(i.plan)}]`
                    : ""
                }
                × ${i.qty}
                — ${money(i.line)}
              `)
              .join("<br>")}
          </p>

          <p>
            <b>
              Total:
              ${money(o.subtotal)}
            </b>
          </p>

          <p>
            Payment:
            <b>
              ${esc(
                o.payment_status
              )}
            </b>
            · Order:
            <b>
              ${esc(
                o.order_status
              )}
            </b>
          </p>

          <p>
            Txn:
            ${esc(
              o.transaction_id ||
              "Not provided"
            )}
          </p>

          <div class="adminActions">

            <button
              onclick="setOrder(
                ${o.id},
                'paymentStatus',
                'PAID'
              )"
            >
              MARK PAID
            </button>

            <button
              onclick="setOrder(
                ${o.id},
                'orderStatus',
                'PROCESSING'
              )"
            >
              PROCESSING
            </button>

            <button
              onclick="setOrder(
                ${o.id},
                'orderStatus',
                'DELIVERED'
              )"
            >
              DELIVERED
            </button>

            <button
              onclick="setOrder(
                ${o.id},
                'orderStatus',
                'CANCELLED'
              )"
            >
              CANCEL
            </button>

          </div>

        </div>

      `).join("")
      :
      "<div class='checkout'>No orders yet.</div>";
}

async function setOrder(
  id,
  key,
  val
) {
  await api(
    "/api/admin/orders/" + id,
    {
      method: "PUT",

      headers: {
        Authorization:
          "Bearer " + adminToken
      },

      body: JSON.stringify({
        [key]: val
      })
    }
  );

  loadOrders();
}

async function adminLogout() {
  try {
    await api(
      "/api/admin/logout",
      {
        method: "POST",

        headers: {
          Authorization:
            "Bearer " + adminToken
        }
      }
    );
  } catch (e) {}

  adminToken = "";

  localStorage.removeItem(
    "matryx_admin"
  );

  $("dashboard")
    .classList.add("hidden");

  $("adminLogin")
    .classList.remove("hidden");
}

function closeModal() {
  $("modal")
    .classList.add("hidden");
}

function esc(s) {
  return String(s ?? "")
    .replace(
      /[&<>"']/g,
      c =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        }[c])
    );
}

function escAttr(s) {
  return esc(s)
    .replace(
      /`/g,
      "&#96;"
    );
}

load().catch(
  e => console.error(e)
);
