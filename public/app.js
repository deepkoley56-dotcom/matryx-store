let products=[],cart=JSON.parse(localStorage.getItem("matryx_cart")||"[]"),config={},adminToken=localStorage.getItem("matryx_admin")||"";

const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat("en-IN",{style:"currency",currency:config.currency||"INR"}).format(Number(n)||0);

async function api(url,opt={}) {
  const r=await fetch(url,{...opt,headers:{"Content-Type":"application/json",...(opt.headers||{})}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||"Request failed");
  return data;
}
function saveCart(){localStorage.setItem("matryx_cart",JSON.stringify(cart));updateCount()}
function updateCount(){$("cartCount").textContent=cart.reduce((a,x)=>a+x.qty,0)}
function hideViews(){["shopView","cartView","adminView"].forEach(x=>$(x).classList.add("hidden"))}
function showShop(){hideViews();$("shopView").classList.remove("hidden")}
function openCart(){hideViews();$("cartView").classList.remove("hidden");renderCart()}
function openAdmin(){hideViews();$("adminView").classList.remove("hidden");if(adminToken)loadDashboard()}
async function load(){
  config=await api("/api/config");$("storeName").textContent=config.storeName||"MATRYX STORE";$("upiText").textContent=config.upiId||"Not configured";
  products=await api("/api/products");renderProducts();updateCount();
}
function renderProducts(){
  $("products").innerHTML=products.map(p=>`
  <article class="card"><img src="${esc(p.image||"https://placehold.co/900x650/090909/ff1b2d?text=MATRYX")}" onerror="this.src='https://placehold.co/900x650/090909/ff1b2d?text=MATRYX'">
  <div class="cardBody"><h3>${esc(p.name)}</h3><p class="muted">${esc(p.description||"")}</p><div class="price">${money(p.price)}</div>
  <p class="muted">Stock: ${p.stock}</p><button class="primary" ${p.stock<1?"disabled":""} onclick="addCart(${p.id})">${p.stock<1?"OUT OF STOCK":"ADD TO CART"}</button></div></article>`).join("");
}
function addCart(id){let p=products.find(x=>x.id===id);let x=cart.find(x=>x.id===id);if(x)x.qty=Math.min(x.qty+1,p.stock);else cart.push({id,qty:1});saveCart();openCart()}
function renderCart(){
  if(!cart.length){$("cartItems").innerHTML="<div class='checkout'><p>Your cart is empty.</p></div>";$("cartTotal").textContent=money(0);return}
  let total=0;
  $("cartItems").innerHTML=cart.map(x=>{let p=products.find(p=>p.id===x.id);if(!p)return "";let line=Number(p.price)*x.qty;total+=line;return `<div class="cartRow"><div><strong>${esc(p.name)}</strong><div class="muted">${money(p.price)} × ${x.qty}</div></div><div class="qty"><button onclick="changeQty(${p.id},-1)">−</button> <b>${x.qty}</b> <button onclick="changeQty(${p.id},1)">+</button> <button onclick="removeCart(${p.id})">✕</button></div></div>`}).join("");
  $("cartTotal").textContent=money(total);
}
function changeQty(id,d){let x=cart.find(x=>x.id===id),p=products.find(p=>p.id===id);if(!x)return;x.qty+=d;if(x.qty<=0)cart=cart.filter(y=>y.id!==id);else x.qty=Math.min(x.qty,p.stock);saveCart();renderCart()}
function removeCart(id){cart=cart.filter(x=>x.id!==id);saveCart();renderCart()}
function payUPI(){
  if(!config.upiId){alert("Admin has not configured UPI ID yet.");return}
  const total=cart.reduce((s,x)=>{let p=products.find(p=>p.id===x.id);return s+(p?Number(p.price)*x.qty:0)},0);
  const uri=`upi://pay?pa=${encodeURIComponent(config.upiId)}&pn=${encodeURIComponent(config.storeName)}&am=${total.toFixed(2)}&cu=INR`;
  location.href=uri;
}
async function placeOrder(){
  if(!cart.length)return alert("Cart is empty.");
  const customerName=$("cName").value.trim(),customerPhone=$("cPhone").value.trim();
  if(!customerName||!customerPhone)return alert("Enter your name and phone.");
  const items=cart.map(x=>({id:x.id,qty:x.qty}));
  try{
    const r=await api("/api/orders",{method:"POST",body:JSON.stringify({
      customerName,customerPhone,address:$("cAddress").value.trim(),items,paymentMethod:"UPI",
      transactionId:$("cTxn").value.trim(),notes:$("cNotes").value.trim()
    })});
    const lines=cart.map(x=>{let p=products.find(p=>p.id===x.id);return `${p.name} x ${x.qty} = ${money(Number(p.price)*x.qty)}`}).join("\n");
    const msg=`Hello ${config.storeName}, I want to place Order #${r.orderId}.\n\n${lines}\n\nTotal: ${money(r.subtotal)}\nName: ${customerName}\nPhone: ${customerPhone}\nAddress: ${$("cAddress").value.trim()}\nUPI Transaction ID: ${$("cTxn").value.trim()}`;
    cart=[];saveCart();$("orderResult").innerHTML=`<div class="success">Order #${r.orderId} created successfully. Opening WhatsApp…</div>`;renderCart();
    if(config.whatsapp){setTimeout(()=>location.href=`https://wa.me/${config.whatsapp.replace(/\D/g,"")}?text=${encodeURIComponent(msg)}`,500)}
  }catch(e){alert(e.message)}
}
async function adminLogin(){
  try{const r=await api("/api/admin/login",{method:"POST",body:JSON.stringify({username:$("aUser").value,password:$("aPass").value})});adminToken=r.token;localStorage.setItem("matryx_admin",adminToken);loadDashboard()}catch(e){$("adminMsg").textContent=e.message}
}
async function loadDashboard(){
  $("adminLogin").classList.add("hidden");$("dashboard").classList.remove("hidden");adminTab("products")
}
function adminTab(tab){
  if(tab==="products"){$("productAdmin").classList.remove("hidden");$("orderAdmin").classList.add("hidden");loadAdminProducts()}
  else{$("productAdmin").classList.add("hidden");$("orderAdmin").classList.remove("hidden");loadOrders()}
}
async function loadAdminProducts(){
  const ps=await api("/api/admin/products",{headers:{Authorization:"Bearer "+adminToken}});
  $("productAdmin").innerHTML=`<div class="productForm"><h3>Add Product</h3>
  <input id="pn" placeholder="Product name"><textarea id="pd" placeholder="Description"></textarea><input id="pp" type="number" step="0.01" placeholder="Price"><input id="pi" placeholder="Image URL"><input id="ps" type="number" placeholder="Stock"><button class="primary" onclick="createProduct()">ADD PRODUCT</button></div>`+
  ps.map(p=>`<div class="adminItem"><strong>${esc(p.name)}</strong> — ${money(p.price)} — stock ${p.stock}<div class="adminActions"><button onclick='editProduct(${JSON.stringify(p)})'>EDIT</button><button onclick="deleteProduct(${p.id})">DELETE</button></div></div>`).join("");
}
async function createProduct(){
  await api("/api/admin/products",{method:"POST",headers:{Authorization:"Bearer "+adminToken},body:JSON.stringify({name:$("pn").value,description:$("pd").value,price:$("pp").value,image:$("pi").value,stock:$("ps").value,active:true})});loadAdminProducts();load();
}
function editProduct(p){
  $("modalContent").innerHTML=`<h2>Edit Product</h2><div class="productForm"><input id="en" value="${escAttr(p.name)}"><textarea id="ed">${esc(p.description||"")}</textarea><input id="ep" type="number" step="0.01" value="${p.price}"><input id="ei" value="${escAttr(p.image||"")}"><input id="es" type="number" value="${p.stock}"><button class="primary" onclick="updateProduct(${p.id})">SAVE</button></div>`;$("modal").classList.remove("hidden")
}
async function updateProduct(id){
  await api("/api/admin/products/"+id,{method:"PUT",headers:{Authorization:"Bearer "+adminToken},body:JSON.stringify({name:$("en").value,description:$("ed").value,price:$("ep").value,image:$("ei").value,stock:$("es").value,active:true})});closeModal();loadAdminProducts();load()
}
async function deleteProduct(id){if(!confirm("Delete this product?"))return;await api("/api/admin/products/"+id,{method:"DELETE",headers:{Authorization:"Bearer "+adminToken}});loadAdminProducts();load()}
async function loadOrders(){
  const os=await api("/api/admin/orders",{headers:{Authorization:"Bearer "+adminToken}});
  $("orderAdmin").innerHTML=os.length?os.map(o=>`<div class="orderCard"><h3>Order #${o.id}</h3><p><b>${esc(o.customer_name)}</b> · ${esc(o.customer_phone)}</p><p>${esc(o.customer_address||"")}</p><p>${(o.items||[]).map(i=>`${esc(i.name)} × ${i.qty}`).join("<br>")}</p><p><b>Total: ${money(o.subtotal)}</b></p><p>Payment: <b>${esc(o.payment_status)}</b> · Order: <b>${esc(o.order_status)}</b></p><p>Txn: ${esc(o.transaction_id||"Not provided")}</p><div class="adminActions"><button onclick="setOrder(${o.id},'paymentStatus','PAID')">MARK PAID</button><button onclick="setOrder(${o.id},'orderStatus','PROCESSING')">PROCESSING</button><button onclick="setOrder(${o.id},'orderStatus','DELIVERED')">DELIVERED</button><button onclick="setOrder(${o.id},'orderStatus','CANCELLED')">CANCEL</button></div></div>`).join(""):"<div class='checkout'>No orders yet.</div>"
}
async function setOrder(id,key,val){await api("/api/admin/orders/"+id,{method:"PUT",headers:{Authorization:"Bearer "+adminToken},body:JSON.stringify({[key]:val})});loadOrders()}
async function adminLogout(){try{await api("/api/admin/logout",{method:"POST",headers:{Authorization:"Bearer "+adminToken}})}catch(e){}adminToken="";localStorage.removeItem("matryx_admin");$("dashboard").classList.add("hidden");$("adminLogin").classList.remove("hidden")}
function closeModal(){$("modal").classList.add("hidden")}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function escAttr(s){return esc(s).replace(/`/g,"&#96;")}
load().catch(e=>console.error(e));
