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
    "historyView",
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

  window.adminProducts = ps;

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

      <div class="videoUploadBox">
  <label for="pvFile">PRODUCT VIDEO</label>
  <input
    id="pvFile"
    type="file"
    accept="video/*"
  >
  <small id="pvStatus">Select a video to upload</small>
</div>

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


async function uploadProductVideo(inputId, statusId) {
  const input = document.getElementById(inputId);
  const status = document.getElementById(statusId);

  if (!input || !input.files || !input.files[0]) {
    return "";
  }

  const file = input.files[0];

  if (!file.type.startsWith("video/")) {
    throw new Error("Please select a video file");
  }

  if (file.size > 100 * 1024 * 1024) {
    throw new Error("Video must be smaller than 100 MB");
  }

  if (status) status.textContent = "Uploading video...";

  const form = new FormData();
  form.append("video", file);

  const r = await fetch("/api/admin/upload-video", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + adminToken
    },
    body: form
  });

  const data = await r.json();

  if (!r.ok || !data.ok) {
    throw new Error(data.error || "Video upload failed");
  }

  if (status) status.textContent = "Video uploaded successfully ✓";

  return data.url;
}

async function createProduct() {
  try {
    const plans = parsePlans($("plans").value);

    const videoUrl = await uploadProductVideo(
      "pvFile",
      "pvStatus"
    );

    await api("/api/admin/products", {
      method: "POST",

      headers: {
        Authorization: "Bearer " + adminToken
      },

      body: JSON.stringify({
        name: $("pn").value,
        description: $("pd").value,
        image: $("pi").value,
        video: videoUrl,
        stock: $("ps").value,
        plans,
        price: plans[0]?.price || 0,
        active: true
      })
    });

    await loadAdminProducts();
    await load();

  } catch (e) {
    alert(e.message || "Could not create product");
  }
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

      <div class="videoUploadBox">
        <label for="evFile">PRODUCT VIDEO</label>

        ${
          p.video
            ? `
              <video
                src="${escAttr(p.video)}"
                controls
                playsinline
                style="width:100%;max-height:220px;border-radius:10px;margin-bottom:10px"
              ></video>
            `
            : ""
        }

        <input
          id="evFile"
          type="file"
          accept="video/*"
        >

        <small id="evStatus">
          ${
            p.video
              ? "Choose another video to replace it"
              : "No video uploaded"
          }
        </small>
      </div>

      <input
        id="es"
        type="number"
        value="${p.stock}"
        placeholder="Stock"
      >

      <textarea
        id="eplans"
        placeholder="1 Hour | 50&#10;1 Day | 100"
      >${esc(plansToText(p.plans))}</textarea>

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

  $("modal").classList.remove("hidden");
}

async function updateProduct(id) {
  try {
    const plans = parsePlans($("eplans").value);

    const fileInput = $("evFile");
    let videoUrl = "";

    if (
      fileInput &&
      fileInput.files &&
      fileInput.files[0]
    ) {
      videoUrl = await uploadProductVideo(
        "evFile",
        "evStatus"
      );
    } else {
      const currentProducts = await api(
        "/api/admin/products",
        {
          headers: {
            Authorization:
              "Bearer " + adminToken
          }
        }
      );

      const current = currentProducts.find(
        p => Number(p.id) === Number(id)
      );

      videoUrl = current?.video || "";
    }

    await api(
      "/api/admin/products/" + id,
      {
        method: "PUT",

        headers: {
          Authorization: "Bearer " + adminToken
        },

        body: JSON.stringify({
          name: $("en").value,
          description: $("ed").value,
          image: $("ei").value,
          video: videoUrl,
          stock: $("es").value,
          plans,
          price: plans[0]?.price || 0,
          active: true
        })
      }
    );

    closeModal();

    await loadAdminProducts();
    await load();

  } catch (e) {
    alert(e.message || "Could not update product");
  }
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

          <h3>Order #${o.id}</h3>

          <p>
            <b>${esc(o.customer_name)}</b>
            · ${esc(o.customer_phone)}
          </p>

          <p>
            ${(o.items || [])
              .map(i => `
                ${esc(i.name)}
                ${i.plan ? ` [${esc(i.plan)}]` : ""}
                × ${i.qty}
                — ${money(i.line)}
              `)
              .join("<br>")}
          </p>

          <p>
            <b>Total: ${money(o.subtotal)}</b>
          </p>

          <p>
            Payment:
            <b>${esc(o.payment_status)}</b>
            · Order:
            <b>${esc(o.order_status)}</b>
          </p>

          <p>
            Txn:
            ${esc(o.transaction_id || "Not provided")}
          </p>

          <div class="deliveryAdminBox">

            <h4>DELIVERY ACCESS</h4>

            <input
              id="deliveryKey-${o.id}"
              value="${esc(o.delivery_key || "")}"
              placeholder="Delivery Key"
            >

            <div class="customDurationRow">
              <input
                id="deliveryDuration-${o.id}"
                type="number"
                min="1"
                step="1"
                placeholder="Enter time"
              >

              <select id="deliveryUnit-${o.id}">
                <option value="minutes">Minutes</option>
                <option value="hours" selected>Hours</option>
                <option value="days">Days</option>
              </select>
            </div>

            <button
              class="primary"
              onclick="saveDelivery(${o.id})"
            >
              SAVE DELIVERY
            </button>

            ${
              o.delivery_key
                ? `<p class="deliverySaved">
                    KEY: <b>${esc(o.delivery_key)}</b>
                    ${
                      o.delivery_expires_at
                        ? `<br>Expires: ${esc(
                            new Date(o.delivery_expires_at).toLocaleString()
                          )}`
                        : ""
                    }
                  </p>`
                : `<p class="deliverySaved muted">
                    No delivery key assigned
                  </p>`
            }

          </div>

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
      : "<div class='checkout'>No orders yet.</div>";
}

async function saveDelivery(id) {
  const keyEl = $("deliveryKey-" + id);
  const durationEl = $("deliveryDuration-" + id);
  const unitEl = $("deliveryUnit-" + id);

  const deliveryKey = keyEl.value.trim();
  const durationValue = durationEl.value.trim();
  const durationUnit = unitEl.value;

  if (!deliveryKey) {
    alert("Delivery Key enter karo.");
    return;
  }

  if (!durationValue || Number(durationValue) <= 0) {
    alert("Valid delivery time enter karo.");
    return;
  }

  const result = await api(
    "/api/admin/orders/" + id,
    {
      method: "PUT",
      headers: {
        Authorization:
          "Bearer " + adminToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        deliveryKey,
        durationValue,
        durationUnit
      })
    }
  );

  if (!result || result.error) {
    alert(result?.error || "Delivery save failed");
    return;
  }

  alert("Delivery saved successfully.");
  await loadOrders();
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

/* MATRYX CUSTOMER ORDER HISTORY */

function openHistory() {
  $("shopView").classList.add("hidden");
  $("cartView").classList.add("hidden");
  $("adminView").classList.add("hidden");
  $("historyView").classList.remove("hidden");

  $("historyResult").innerHTML = "";
}

async function loadHistory() {
  const orderId = $("historyOrderId").value.trim();
  const phone = $("historyPhone").value.trim();

  if (!orderId || !phone) {
    $("historyResult").innerHTML =
      "<p class='error'>Order ID and phone number required.</p>";
    return;
  }

  $("historyResult").innerHTML =
    "<p class='planHelp'>Loading order...</p>";

  try {
    const result = await api(
      "/api/order-history",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          orderId,
          phone
        })
      }
    );

    if (!result || result.error) {
      $("historyResult").innerHTML =
        `<p class="error">${esc(result?.error || "Order not found")}</p>`;
      return;
    }

    renderHistoryOrder(result);

  } catch (e) {
    $("historyResult").innerHTML =
      "<p class='error'>Could not load order.</p>";
  }
}

function renderHistoryOrder(o) {
  const remainingSeconds =
    o.remainingSeconds !== null &&
    o.remainingSeconds !== undefined
      ? Number(o.remainingSeconds)
      : null;

  $("historyResult").innerHTML = `
    <div class="historyOrderCard">

      <div class="historyTop">
        <div>
          <small>ORDER ID</small>
          <h3>#${esc(o.id)}</h3>
        </div>

        <span class="historyStatus">
          ${esc(o.order_status)}
        </span>
      </div>

      <div class="historyItems">
        ${(o.items || [])
          .map(i => `
            <div class="historyItem">
              <span>
                ${esc(i.name)}
                ${i.plan ? ` · ${esc(i.plan)}` : ""}
                × ${i.qty}
              </span>
              <b>${money(i.line)}</b>
            </div>
          `)
          .join("")}
      </div>

      <div class="historyTotal">
        TOTAL
        <b>${money(o.subtotal)}</b>
      </div>

      ${
        o.delivery_key
          ? `
            <div class="deliveryCustomerBox">

              <div class="deliveryLabel">
                DELIVERY ACCESS
              </div>

              <div class="deliveryKey">
                ${esc(o.delivery_key)}
              </div>

              <div id="deliveryTimer-${o.id}" class="deliveryTimer">
                Checking...
              </div>

            </div>
          `
          : `
            <div class="deliveryPending">
              Delivery key has not been assigned yet.
            </div>
          `
      }

    </div>
  `;

  if (remainingSeconds !== null) {
    startDeliveryTimer(
      o.id,
      remainingSeconds
    );
  }
}

function startDeliveryTimer(id, remainingSeconds) {
  const el = $("deliveryTimer-" + id);

  if (!el) return;

  let remaining = Math.max(
    0,
    Number(remainingSeconds) || 0
  );

  function update() {
    if (remaining <= 0) {
      el.textContent = "EXPIRED";
      el.classList.add("expired");
      return;
    }

    const days =
      Math.floor(remaining / 86400);

    const hours =
      Math.floor((remaining % 86400) / 3600);

    const minutes =
      Math.floor((remaining % 3600) / 60);

    const seconds =
      remaining % 60;

    el.textContent =
      `${days}d ${hours}h ${minutes}m ${seconds}s`;

    remaining--;
    setTimeout(update, 1000);
  }

  update();
}

