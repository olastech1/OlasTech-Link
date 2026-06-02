/**
 * OlasTech Link — Frontend Controller (Production)
 * =================================================
 * Calls the real backend API for payments and code validation.
 * Uses Paystack Inline JS for the payment popup.
 */

(function () {
  'use strict';

  // ── Plan Data (loaded from server) ────────────────────────────
  let PLANS = {};

  // ── DOM References ────────────────────────────────────────────
  const tabCode         = document.getElementById('tabCode');
  const tabBuy          = document.getElementById('tabBuy');
  const panelCode       = document.getElementById('panelCode');
  const panelBuy        = document.getElementById('panelBuy');
  const codeForm        = document.getElementById('codeForm');
  const accessCodeInput = document.getElementById('accessCode');
  const connectBtn      = document.getElementById('connectBtn');
  const btnBuy          = document.getElementById('btnBuy');
  const buyEmail        = document.getElementById('buyEmail');
  const plansGrid       = document.getElementById('plansGrid');
  const manualPaymentPanel = document.getElementById('manualPaymentPanel');
  const manualAmountDisplay= document.getElementById('manualAmountDisplay');
  const whatsappBtn     = document.getElementById('whatsappBtn');
  const cancelManualBtn = document.getElementById('cancelManualBtn');
  const errorMessage    = document.getElementById('errorMessage');
  const errorText       = document.getElementById('errorText');
  const successMessage  = document.getElementById('successMessage');
  const successText     = document.getElementById('successText');
  const successOverlay  = document.getElementById('successOverlay');
  const ssidDisplay     = document.getElementById('ssidDisplay');
  const switchToBuy     = document.getElementById('switchToBuy');
  const switchToCode    = document.getElementById('switchToCode');
  const sessionPlan     = document.getElementById('sessionPlan');
  const sessionDuration = document.getElementById('sessionDuration');
  const sessionData     = document.getElementById('sessionData');

  function showSuccess(sessionInfo) {
    const successOverlay = document.getElementById('successOverlay');
    const displayPlanName = document.getElementById('displayPlanName');
    const displayDuration = document.getElementById('displayDuration');
    const displayData = document.getElementById('displayData');
    
    displayPlanName.textContent = sessionInfo.plan;

    // Calculate Remaining Time
    if (sessionInfo.sessionExpires) {
      const expires = new Date(sessionInfo.sessionExpires);
      const diffMs = expires - new Date();
      if (diffMs > 0) {
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        let timeText = '';
        if (diffDays > 0) timeText += diffDays + ' Days ';
        timeText += diffHours + ' Hours';
        displayDuration.textContent = timeText;
      } else {
        displayDuration.textContent = 'Expired';
      }
    } else {
      displayDuration.textContent = sessionInfo.duration_h + ' Hours';
    }

    // Display Remaining Data
    if (sessionInfo.remaining_mb !== null && sessionInfo.remaining_mb !== undefined) {
      displayData.textContent = (sessionInfo.remaining_mb / 1024).toFixed(2) + ' GB';
    } else if (sessionInfo.data_mb) {
      displayData.textContent = (sessionInfo.data_mb / 1024).toFixed(2) + ' GB';
    } else {
      displayData.textContent = 'Unlimited';
    }

    successOverlay.classList.add('visible');
    
    setTimeout(() => {
      window.location.reload();
    }, 5000);
  }

  // ── Info Modals (About, Terms, Contact) ──────────────────────
  const infoModal = document.getElementById('infoModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');

  const modalContent = {
    about: {
      title: 'About OlasTech Link',
      body: `
        <p>Welcome to <strong>OlasTech Link</strong>, your premium high-speed internet provider.</p>
        <p>We leverage advanced enterprise-grade Omada Controller systems to provide seamless, encrypted, and ultra-fast Wi-Fi connections.</p>
        <p>Our multi-device nodes allow you to share a single access code across your laptops, phones, and smart TVs instantly.</p>
      `
    },
    terms: {
      title: 'Terms of Service',
      body: `
        <h4>1. Acceptable Use</h4>
        <p>By connecting to this network, you agree not to use the service for any illegal or malicious activities. We reserve the right to monitor bandwidth usage for network stability.</p>
        <h4>2. Data Usage & Limits</h4>
        <p>If you exhaust your purchased data quota, your devices will be automatically disconnected. Shared codes count data usage across all connected devices collectively.</p>
        <h4>3. Refunds</h4>
        <p>All token purchases are final. If you experience downtime or issues, please contact our support.</p>
      `
    },
    contact: {
      title: 'Contact Us',
      body: `
        <p>Need help with your connection or a token?</p>
        <p><strong>Phone / WhatsApp:</strong> +234 816 274 7882</p>
        <p><strong>Email:</strong> support@olastech.ng</p>
        <p><strong>Operating Hours:</strong> 24/7 Monitoring & Support</p>
      `
    }
  };

  function openModal(type) {
    if (!modalContent[type]) return;
    modalTitle.textContent = modalContent[type].title;
    modalBody.innerHTML = modalContent[type].body;
    infoModal.classList.add('visible');
  }

  document.getElementById('linkAbout')?.addEventListener('click', (e) => { e.preventDefault(); openModal('about'); });
  document.getElementById('linkTerms')?.addEventListener('click', (e) => { e.preventDefault(); openModal('terms'); });
  document.getElementById('linkContact')?.addEventListener('click', (e) => { e.preventDefault(); openModal('contact'); });
  
  modalClose?.addEventListener('click', () => { infoModal.classList.remove('visible'); });
  infoModal?.addEventListener('click', (e) => {
    if (e.target === infoModal) infoModal.classList.remove('visible');
  });

  // ── State ─────────────────────────────────────────────────────
  let selectedPlan = null;
  let paystackPublicKey = null;

  // ── TP-Link Omada URL Parameters ──────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const portalConfig = {
    clientMac:   params.get('clientMac')   || params.get('client_mac')   || '',
    apMac:       params.get('apMac')       || params.get('ap_mac')       || '',
    ssidName:    params.get('ssidName')    || params.get('ssid')         || 'OlasTech_WiFi',
    radioId:     params.get('radioId')     || params.get('radio_id')     || '0',
    redirectUrl: params.get('redirectUrl') || params.get('redirect_url') || 'https://www.google.com',
  };

  // ── Initialize ────────────────────────────────────────────────
  async function init() {
    if (portalConfig.ssidName) ssidDisplay.textContent = portalConfig.ssidName;

    // Fetch dynamic plans
    try {
      const res = await fetch('/api/plans');
      const data = await res.json();
      if (data.success && data.plans) {
        data.plans.forEach(p => PLANS[p.id] = p);
        renderPlans(data.plans);
      } else {
        plansGrid.innerHTML = '<div style="color:var(--red);text-align:center;width:100%;padding:20px">Failed to load plans.</div>';
      }
    } catch (e) {
      plansGrid.innerHTML = '<div style="color:var(--red);text-align:center;width:100%;padding:20px">Failed to connect to server.</div>';
    }

    // Auto-fill code if coming back from Paystack callback
    const codeParam = params.get('code');
    const paidParam = params.get('paid');
    const errParam  = params.get('error');

    if (codeParam && paidParam) {
      accessCodeInput.value = codeParam;
      connectBtn.disabled = false;
      switchTab('code');
      showSuccess(`✅ Payment confirmed! Your code: ${codeParam} — Click Connect to go online.`);
    }

    if (errParam) {
      switchTab('buy');
      showError(errorMessages[errParam] || 'Something went wrong. Please try again.');
    }

    bindEvents();
  }

  function renderPlans(plansList) {
    if (!plansGrid) return;
    plansGrid.innerHTML = '';
    
    plansList.forEach(plan => {
      const isBest = plan.is_best_value;
      const isPop = plan.is_popular;
      
      let topHtml = `<span class="plan-name">${plan.name}</span>`;
      if (isBest) {
        topHtml += `<span class="plan-badge best-value">Best Value</span>`;
      } else if (isPop) {
        topHtml += `<span class="plan-badge popular">Popular</span>`;
      }

      const dataText = plan.data_mb ? `${Math.floor(plan.data_mb / 1024)} GB` : 'Unlimited Data';
      const timeText = plan.data_mb ? '' : `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${plan.duration_h} Hr</span>`;

      const card = document.createElement('div');
      card.className = 'plan-card';
      card.setAttribute('data-plan', plan.id);
      card.setAttribute('tabindex', '0');
      card.innerHTML = `
        <div class="plan-top">
          ${topHtml}
        </div>
        <div class="plan-details">
          <span class="plan-price"><span class="currency">₦</span>${parseInt(plan.price).toLocaleString()}</span>
          <div class="plan-meta">
            <span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> ${plan.devices} Device${plan.devices > 1 ? 's' : ''}</span>
            ${timeText}
            ${plan.data_mb ? `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M2 12h20"/></svg> ${dataText}</span>` : ''}
          </div>
        </div>
      `;
      plansGrid.appendChild(card);
    });

    // Bind events for the newly created cards
    const newCards = plansGrid.querySelectorAll('.plan-card');
    newCards.forEach(card => {
      card.addEventListener('click', handlePlanClick);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handlePlanClick(e);
        }
      });
    });
  }

  const errorMessages = {
    payment_failed:    'Payment was not completed. Please try again.',
    payment_not_found: 'Payment reference not found. Contact support.',
    missing_reference: 'Payment reference missing. Please try again.',
  };

  // ── Events ────────────────────────────────────────────────────
  function bindEvents() {
    tabCode.addEventListener('click', () => switchTab('code'));
    tabBuy.addEventListener('click', () => switchTab('buy'));
    switchToBuy.addEventListener('click', (e) => { e.preventDefault(); switchTab('buy'); });
    switchToCode.addEventListener('click', (e) => { e.preventDefault(); switchTab('code'); });

    accessCodeInput.addEventListener('input', onCodeInput);
    codeForm.addEventListener('submit', handleCodeSubmit);

    // Plans grid click bindings are now handled inside renderPlans()
    if (btnBuy) btnBuy.addEventListener('click', handleBuyClick);
  }

  // ── Tab Switching ─────────────────────────────────────────────
  function switchTab(tab) {
    hideError(); hideSuccess();
    tabCode.classList.toggle('active', tab === 'code');
    tabBuy.classList.toggle('active', tab === 'buy');
    tabCode.setAttribute('aria-selected', tab === 'code');
    tabBuy.setAttribute('aria-selected', tab === 'buy');
    panelCode.classList.toggle('active', tab === 'code');
    panelBuy.classList.toggle('active', tab === 'buy');
    // Re-trigger panel animation
    const panel = tab === 'code' ? panelCode : panelBuy;
    panel.style.animation = 'none';
    void panel.offsetHeight;
    panel.style.animation = '';
    if (tab === 'code') accessCodeInput.focus();
  }

  // ── Code Input ────────────────────────────────────────────────
  function onCodeInput() {
    connectBtn.disabled = accessCodeInput.value.trim().length === 0;
    accessCodeInput.classList.remove('error');
    hideError();
  }

  // ── Code Submission ───────────────────────────────────────────
  async function handleCodeSubmit(e) {
    e.preventDefault();
    const code = accessCodeInput.value.trim().toUpperCase();
    if (!code) {
      showError('Please enter your access code.');
      accessCodeInput.classList.add('error');
      return;
    }

    setLoading(connectBtn, true, 'Connecting…');
    hideError();

    try {
      const res = await fetch('/api/code/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          clientMac: portalConfig.clientMac,
          apMac:     portalConfig.apMac,
          radioId:   portalConfig.radioId,
          ssidName:  portalConfig.ssidName,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Invalid access code.');
      }

      onConnected(data);
    } catch (err) {
      setLoading(connectBtn, false, 'Connect to Internet');
      showError(err.message);
      accessCodeInput.classList.add('error');
    }
  }

  // ── Plan Selection ────────────────────────────────────────────
  function handlePlanClick(e) {
    const card = e.target.closest('.plan-card');
    if (!card) return;
    plansGrid.querySelectorAll('.plan-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    selectedPlan = card.dataset.plan;
    const plan = PLANS[selectedPlan];
    if (btnBuy) {
      btnBuy.disabled = false;
      btnBuy.textContent = `Pay ₦${plan.price.toLocaleString()} for Access`;
    }
    
    // Enable and configure WhatsApp button
    const whatsappBtn = document.getElementById('whatsappBuyBtn');
    if (whatsappBtn) {
      whatsappBtn.style.opacity = '1';
      whatsappBtn.style.pointerEvents = 'auto';
      
      const message = `Hello OlasTech, I want to purchase the ${plan.name} Plan for ₦${plan.price.toLocaleString()}.\n\nMy MAC Address: ${portalConfig.clientMac}`;
      whatsappBtn.href = `https://wa.me/2348162747882?text=${encodeURIComponent(message)}`;
    }
  }

  // ── Buy Flow (Flutterwave) ────────────────────────────────────
  async function handleBuyClick() {
    if (!selectedPlan) { showError('Please select a plan first.'); return; }
    
    setLoading(btnBuy, true, 'Preparing payment…');
    hideError();
    const plan = PLANS[selectedPlan];
    const emailStr = buyEmail ? buyEmail.value.trim() : '';

    if (!emailStr) { 
      setLoading(btnBuy, false);
      btnBuy.textContent = `Pay ₦${plan.price.toLocaleString()} for Access`;
      showError('Please enter your email address.'); 
      return; 
    }
    
    try {
      // 1. Initialize payment on our backend
      const res = await fetch('/api/pay/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId:    selectedPlan,
          email:     emailStr,
          clientMac: portalConfig.clientMac,
          apMac:     portalConfig.apMac,
          radioId:   portalConfig.radioId,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Payment init failed.');

      // Save reference so we can recover if modal closes without callback
      localStorage.setItem('pending_tx_ref', data.reference);
      localStorage.setItem('pending_tx_id', '');

      setLoading(btnBuy, false);
      btnBuy.textContent = `Pay ₦${plan.price.toLocaleString()} for Access`;

      // 2. Open Flutterwave Inline Modal
      if (window.FlutterwaveCheckout) {
        FlutterwaveCheckout({
          public_key: data.publicKey,
          tx_ref: data.reference,
          amount: data.amount,
          currency: "NGN",
          payment_options: "card,ussd",
          customer: {
            email: emailStr,
            name: "OlasTech Customer",
          },
          customizations: {
            title: "OlasTech Link",
            description: `Payment for ${data.name} Plan`,
          },
          callback: async function (payment) {
            // 3. Payment succeeded — verify on our backend
            console.log("Flutterwave callback:", payment);
            localStorage.setItem('pending_tx_id', payment.transaction_id || '');
            setLoading(btnBuy, true, 'Verifying payment…');
            await verifyAndComplete(payment.transaction_id, payment.tx_ref);
          },
          onclose: function() {
            // Modal closed — check if payment went through
            const savedRef = localStorage.getItem('pending_tx_ref');
            const savedId  = localStorage.getItem('pending_tx_id');
            if (savedId) {
              // Payment was made, callback fired, verification in progress
              return;
            }
            if (savedRef) {
              // Modal closed without payment callback — show recovery option
              setLoading(btnBuy, false);
              btnBuy.textContent = `Pay ₦${plan.price.toLocaleString()} for Access`;
              showError(
                '⚠️ If you completed payment, click <strong style="cursor:pointer;text-decoration:underline" onclick="recoverPayment(\'' + savedRef + '\')">' +
                'Recover My Code</strong> to get your access code.'
              );
            }
          }
        });
      } else {
        throw new Error('Payment system failed to load. Please refresh the page.');
      }
      
    } catch (err) {
      setLoading(btnBuy, false);
      if (selectedPlan) {
        const plan2 = PLANS[selectedPlan];
        btnBuy.textContent = `Pay ₦${plan2.price.toLocaleString()} for Access`;
      }
      showError(err.message || 'Could not start payment. Check your connection.');
    }
  }

  async function verifyAndComplete(transactionId, txRef) {
    try {
      const verifyRes = await fetch('/api/pay/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: transactionId, tx_ref: txRef })
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) {
        throw new Error(verifyData.error || 'Payment verification failed.');
      }
      // Clear pending
      localStorage.removeItem('pending_tx_ref');
      localStorage.removeItem('pending_tx_id');
      // Success — fill code and connect
      accessCodeInput.value = verifyData.code;
      connectBtn.disabled = false;
      setLoading(btnBuy, false);
      switchTab('code');
      showSuccess(`✅ Payment confirmed! Your code: <strong>${verifyData.code}</strong> — click Connect below.`);
    } catch (err) {
      setLoading(btnBuy, false);
      showError('❌ ' + err.message + ' — Email hi@olaniyi.me if you were charged.');
    }
  }

  // Global: called from recover link in error message
  window.recoverPayment = async function(txRef) {
    setLoading(btnBuy, true, 'Recovering code…');
    hideError();
    try {
      const res = await fetch('/api/pay/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_ref: txRef })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error);
      localStorage.removeItem('pending_tx_ref');
      accessCodeInput.value = data.code;
      connectBtn.disabled = false;
      setLoading(btnBuy, false);
      switchTab('code');
      showSuccess(`✅ Code recovered: <strong>${data.code}</strong> — click Connect below.`);
    } catch(err) {
      setLoading(btnBuy, false);
      showError('Could not recover: ' + err.message + '. Email hi@olaniyi.me for help.');
    }
  };

  // ── On Connected ──────────────────────────────────────────────
  function onConnected(data) {
    sessionPlan.textContent     = data.plan     || '—';
    
    // Calculate Remaining Time
    if (data.sessionExpires) {
      const expires = new Date(data.sessionExpires);
      const diffMs = expires - new Date();
      if (diffMs > 0) {
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        sessionDuration.textContent = (diffDays > 0 ? diffDays + 'd ' : '') + diffHours + 'h';
      } else {
        sessionDuration.textContent = 'Expired';
      }
    } else {
      sessionDuration.textContent = data.duration_h ? `${data.duration_h}h` : '—';
    }

    // Display Remaining Data
    if (data.remaining_mb !== null && data.remaining_mb !== undefined) {
      sessionData.textContent = `${(data.remaining_mb / 1024).toFixed(2)} GB`;
    } else if (data.data_mb) {
      sessionData.textContent = `${(data.data_mb / 1024).toFixed(2)} GB`;
    } else {
      sessionData.textContent = data.data_mb === null ? 'Unlimited' : '—';
    }

    successOverlay.classList.add('visible');

    const redirect = data.redirectUrl || portalConfig.redirectUrl || 'https://www.google.com';
    setTimeout(() => { window.location.href = redirect; }, 3500);
  }

  // ── UI Helpers ────────────────────────────────────────────────
  function showError(msg) {
    errorText.textContent = msg;
    errorMessage.classList.add('visible');
    errorMessage.style.animation = 'none';
    void errorMessage.offsetHeight;
    errorMessage.style.animation = '';
  }
  function hideError()   { errorMessage.classList.remove('visible'); }
  function showSuccess(msg) { successText.textContent = msg; successMessage.classList.add('visible'); }
  function hideSuccess() { successMessage.classList.remove('visible'); }

  function setLoading(btn, loading, label) {
    if (loading) {
      btn.classList.add('loading');
      btn.disabled = true;
    } else {
      btn.classList.remove('loading');
      if (label) btn.textContent = label;
    }
  }

  // ── Boot ──────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
