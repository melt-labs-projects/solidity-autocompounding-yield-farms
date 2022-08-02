const AutoCompound = artifacts.require('AutoCompoundFarm');
const Token = artifacts.require('Token');
const { expectRevert } = require('@openzeppelin/test-helpers');


// Helper for converting to wei
const toWei = (ether) => { return web3.utils.toWei(ether.toString(), 'ether'); }

// Helper for converting from wei
const fromWei = (wei) => { return web3.utils.fromWei(wei); }

// Helper for retrieving the blockNumber
const getBlockNumber = async () => {
    return await web3.eth.getBlockNumber();
}

// Helper for depositing ether amount in a farm
const deposit = async (contract, account, amount) => {
    await contract.deposit(amount, { from: account });
}

// Helper for withdrawing ether amount from farm
const withdraw = async (contract, account, amount) => {
    await contract.withdraw(amount, { from: account });
}

// Helper for claiming rewards
const claim = async (contract, account) => {
    await contract.claim({ from: account });
}

// Helper for updating farm
const update = async (contract) => {
    await contract.update();
}

// Helper to assert the amount of pending rewards
const assertPending = async (contract, account, amount) => {
    let value = await contract.getPending(account);
    assert.equal(amount, value);
}

const assertClose = (a, b, epsilon=0.1) => {
    if (Math.abs(a - b) > epsilon) {
        throw Error()
    }
}


contract('Basic Tests', accounts => {

    let farm;
    let rwt;
    let owner = accounts[0];
    let vault = accounts[1];
    let maxRewardsPerBlock = toWei(100);
    let targetDailyCompoundRate = toWei(1.05)
    let fee = 0;
    let deployedBlockNum;

    before(async () => {
        let TenBillion = toWei(10000000000)
        let OneBillion = toWei(1000000000)

        rwt = await Token.new(TenBillion, { from: owner })
        farm = await AutoCompound.new(rwt.address, vault, maxRewardsPerBlock, 
            targetDailyCompoundRate, fee, fee, { from: owner });

        let receipt = await web3.eth.getTransaction(farm.transactionHash);
        deployedBlockNum = receipt.blockNumber;
        
        await rwt.increaseAllowance(farm.address, TenBillion, { from: owner });
        await rwt.transfer(farm.address, OneBillion, { from: owner });

    });

    it('should set fields', async () => {
        assert.equal(await farm.rwt(), rwt.address);
        assert.equal(await farm.multiplierIsMaxed(), false);
        assert.equal(await farm.dailyBlocks(), toWei(20 * 60 * 24));
        assert.equal(await farm.totalStaked(), 0);
        assert.equal(await farm.totalPending(), 0);
        assert.equal(await farm.multiplier(), toWei(1));
        assert.equal(await farm.depositFee(), 0);
        assert.equal(await farm.withdrawFee(), 0);
        assert.equal(await farm.targetDailyCompoundRate(), targetDailyCompoundRate);
        assert.equal(await farm.maxRewardsPerBlock(), maxRewardsPerBlock);
        assert.equal(await farm.rewardsPerBlock(), 0);
        assert.equal(await farm.lastRewardBlock(), deployedBlockNum);
        assert.equal(await farm.finalBlock(), 2**256 - 1);
        assert.equal(await farm.vault(), vault);
        assert.equal(await farm.paused(), false);
    });

    it('should update deposit fee', async () => {
        await farm.changeDepositFee(100);
        assert.equal(await farm.depositFee(), 100);
        await farm.changeDepositFee(0);
    });

    it('should update withdraw fee', async () => {
        await farm.changeWithdrawFee(100);
        assert.equal(await farm.withdrawFee(), 100);
        await farm.changeWithdrawFee(0);
    });

    it('should revert changeFee', async () => {
        expectRevert.unspecified(farm.changeDepositFee(10001));
        expectRevert.unspecified(farm.changeWithdrawFee(10001));
        assert.equal(await farm.depositFee(), 0);
        assert.equal(await farm.withdrawFee(), 0);
    });

    it('should update targetDailyCompoundRate', async () => {
        await farm.changeTargetDailyCompoundRate(toWei(1.1));
        assert.equal(await farm.targetDailyCompoundRate(), toWei(1.1));
    });

    it('should revert changeTargetDailyCompoundRate', async () => {
        expectRevert.unspecified(farm.changeTargetDailyCompoundRate(toWei(0.9)));
        assert.equal(await farm.targetDailyCompoundRate(), toWei(1.1));
    });

    it('should update finalBlock', async () => {
        await farm.changeFinalBlock(1000);
        assert.equal(await farm.finalBlock(), 1000);
    });

    it('should update dailyBlocks', async () => {
        await farm.changeDailyBlocks(toWei(30 * 60 * 24));
        assert.equal(await farm.dailyBlocks(), toWei(30 * 60 * 24));
    });

    it('should rever update dailyBlocks', async () => {
        expectRevert.unspecified(farm.changeDailyBlocks(0));
    });

    it('should update vault', async () => {
        await farm.changeVault(accounts[2]);
        assert.equal(await farm.vault(), accounts[2]);
    });

    it('should update maxRewardsPerBlock', async () => {
        await farm.changeMaxRewardsPerBlock(toWei(500));
        assert.equal(await farm.maxRewardsPerBlock(), toWei(500));
        await farm.changeMaxRewardsPerBlock(toWei(100));
        assert.equal(await farm.maxRewardsPerBlock(), toWei(100));
    });

    it('should pause farm', async () => {
        await farm.pause();
        assert.equal(await farm.paused(), true);
    });

    it('should unpause farm', async () => {
        await farm.unpause();
        assert.equal(await farm.paused(), false);
    });

    it('should retrieve APR before deposit', async () => {
        assert.equal(await farm.getAPY(), 0);
    });

    it('should revert when depositing less than 1 token', async () => {
        expectRevert.unspecified(deposit(farm, owner, toWei(0.9)));
    });

    it('should deposit', async () => {
        await deposit(farm, owner, toWei(57600000));
        await farm.update();
        assert.equal(await farm.getDeposit(owner), toWei(57600000));
        assert.equal(await farm.totalStaked(), toWei(57600000));

        let stake = await farm.stakes(owner);
        assert.equal(stake.divisor, toWei(1));
        assert.equal(stake.pastPending, 0);
        assert.equal(stake.amount, toWei(57600000));
        assertClose(fromWei(await farm.totalPending()), 100);
    });

    it('should retrieve APR after deposit', async () => {
        let apr = parseFloat(web3.utils.fromWei(await farm.getAPY()));
        assert.equal(apr.toFixed(1), 27.4);
    });

    it('should retrieve deposit', async () => {
        assert.equal(await farm.getDeposit(owner), toWei(57600000));
    });

    it('should claim rewards', async () => {
        let pending = fromWei(await farm.getPending(owner));
        assertClose(pending, 100);
        let balanceBefore = parseFloat(fromWei(await rwt.balanceOf(owner)));
        await claim(farm, owner);
        let balanceAfter = parseFloat(fromWei(await rwt.balanceOf(owner)));
        await assertPending(farm, owner, 0);
        assertClose(balanceBefore + 200, balanceAfter);

        let stake = await farm.stakes(owner);
        assert.equal(fromWei(stake.divisor), fromWei(await farm.multiplier()));
        assert.equal(stake.pastPending, 0);
        assert.equal(stake.amount, toWei(57600000));
        assertClose(fromWei(await farm.totalPending()), 0);
    });

    it('should revert when withdrawing too much', async () => {
        expectRevert.unspecified(withdraw(farm, owner, toWei(57700000)))
    });

    it('should withdraw', async () => {
        await withdraw(farm, owner, toWei(56600000));
        assert.equal(await farm.getDeposit(owner), toWei(1000000));

        let stake = await farm.stakes(owner);
        assert.equal(fromWei(stake.divisor), fromWei(await farm.multiplier()));
        assert.equal(stake.pastPending, 0);
        assert.equal(stake.amount, toWei(1000000));
        assertClose(fromWei(await farm.totalPending()), 0);
        assert.equal(await farm.totalStaked(), toWei(1000000));

        await withdraw(farm, owner, toWei(1000000));
        assert.equal(await farm.getDeposit(owner), 0);

        stake = await farm.stakes(owner);
        assert.equal(fromWei(stake.divisor), 0);
        assert.equal(stake.pastPending, 0);
        assert.equal(stake.amount, 0);
        assertClose(fromWei(await farm.totalPending()), 0);
        assert.equal(await farm.totalStaked(), 0);
    });

    it('should withdraw all', async () => {
        await deposit(farm, owner, toWei(57600000));
        assert.equal(await farm.getDeposit(owner), toWei(57600000));
        await farm.withdrawAll({ from: owner });
        assert.equal(await farm.getDeposit(owner), 0);
    });

    it('should emergency withdraw', async () => {
        await deposit(farm, owner, toWei(57600000));
        assert.equal(await farm.getDeposit(owner), toWei(57600000));
        await farm.emergencyWithdraw({ from: owner });
        assert.equal(await farm.getDeposit(owner), 0);

        let stake = await farm.stakes(owner);
        assert.equal(fromWei(stake.divisor), 0);
        assert.equal(stake.pastPending, 0);
        assert.equal(stake.amount, 0);
        assertClose(fromWei(await farm.totalPending()), 0);
        assert.equal(await farm.totalStaked(), 0);
    });

    it('should withdraw with fee', async () => {
        await farm.changeWithdrawFee(5000);
        await deposit(farm, owner, toWei(100000000));
        assert.equal(await farm.getDeposit(owner), toWei(100000000));
        assert.equal(await farm.totalStaked(), toWei(100000000));

        let stake = await farm.stakes(owner);
        assert.equal(fromWei(stake.divisor), fromWei(await farm.multiplier()));
        assert.equal(stake.pastPending, 0);
        assert.equal(stake.amount, toWei(100000000));

        await update(farm);
        assertClose(fromWei(await farm.totalPending()), 100);

        let balanceBefore = parseFloat(fromWei(await rwt.balanceOf(owner)));
        await farm.withdrawAll({ from: owner });
        let balanceAfter = parseFloat(fromWei(await rwt.balanceOf(owner)));
        assertClose(balanceBefore + 50000000 + 100, balanceAfter);
    });

    it('should claim with fee', async () => {
        await deposit(farm, owner, toWei(100000000));
        await update(farm);
        let balanceBefore = parseFloat(fromWei(await rwt.balanceOf(owner)));
        await farm.claim({ from: owner });
        let balanceAfter = parseFloat(fromWei(await rwt.balanceOf(owner)));
        assertClose(balanceBefore + 100, balanceAfter);

        let stake = await farm.stakes(owner);
        assert.equal(fromWei(stake.divisor), fromWei(await farm.multiplier()));
        assert.equal(stake.pastPending, 0);
        assert.equal(stake.amount, toWei(100000000));

        await farm.withdrawAll({ from: owner });

    });

    it('should deposit multiple times', async () => {
        await farm.changeWithdrawFee(0);
        await deposit(farm, owner, toWei(100000000));
        await deposit(farm, owner, toWei(100000000));
        assert.equal(await farm.getDeposit(owner), toWei(200000000));
        assert.equal(await farm.totalStaked(), toWei(200000000));

        let stake = await farm.stakes(owner);
        assert.equal(fromWei(stake.divisor), fromWei(await farm.multiplier()));
        assertClose(fromWei(stake.pastPending), 100);
        assert.equal(stake.amount, toWei(200000000));

        assertClose(fromWei(await farm.getPending(owner)), 100);
        await update(farm)
        assertClose(fromWei(await farm.getPending(owner)), 200);

        await farm.withdrawAll({ from: owner });
    });

    it('should deposit with fee', async () => {
        
        await farm.changeDepositFee(5000);
        await deposit(farm, owner, toWei(100000000));
        assert.equal(await farm.getDeposit(owner), toWei(50000000));
        assert.equal(await farm.totalStaked(), toWei(50000000));

        let stake = await farm.stakes(owner);
        assert.equal(fromWei(stake.divisor), fromWei(await farm.multiplier()));
        assert.equal(stake.pastPending, 0);
        assert.equal(stake.amount, toWei(50000000));

        await update(farm);
        assertClose(fromWei(await farm.totalPending()), 100);
        await farm.withdrawAll({ from: owner });
    });

})

  
contract('Advanced Tests', accounts => {

    let farm;
    let rwt;
    let owner = accounts[0];
    let vault = accounts[1];
    let maxRewardsPerBlock = toWei(100);
    let fee = 0;
    let targetDailyCompoundRate = toWei(1.05);


    beforeEach(async () => {
        let TenBillion = toWei(10000000000)
        let OneBillion = toWei(1000000000)

        rwt = await Token.new(TenBillion, { from: owner })
        farm = await AutoCompound.new(rwt.address, vault, maxRewardsPerBlock, targetDailyCompoundRate, 
            fee, fee, { from: owner });
        
        await rwt.transfer(farm.address, OneBillion, { from: owner });

        for (let i = 0; i < 3; i++) {
            await rwt.increaseAllowance(farm.address, TenBillion, { from: accounts[i] });
            if (accounts[i] != owner) {
                await rwt.transfer(accounts[i], OneBillion, { from: owner });
            }
        }

    });

    it('should test multiplier overflow handler', async () => {
        await farm.changeTargetDailyCompoundRate(toWei(10000000))
        await farm.changeMaxRewardsPerBlock(toWei(10000000000))
       
        for (let i = 0; i < 20; i++) {
            await deposit(farm, owner, toWei(100));
            await withdraw(farm, owner, toWei(100));
        }
        
        assert.equal(await farm.multiplierIsMaxed(), true)
    });

    it('should test autocompounding', async () => {
        await deposit(farm, accounts[0], toWei(99999900));

        assert.equal(await farm.totalStaked(), toWei(99999900));
        await assertPending(farm, accounts[0], 0);
        await assertPending(farm, accounts[1], 0);

        await deposit(farm, accounts[1], toWei(100000000));
        
        assertClose(fromWei(await farm.getPending(accounts[0])), 100);
        await assertPending(farm, accounts[1], 0);

        await update(farm);

        assertClose(fromWei(await farm.getPending(accounts[0])), 150);
        assertClose(fromWei(await farm.getPending(accounts[1])), 50);

        await withdraw(farm, accounts[0], toWei(99999900));

        await assertPending(farm, accounts[0], 0);
        assertClose(fromWei(await farm.getPending(accounts[1])), 100);

        await farm.update();
        await farm.update();
        
        await assertPending(farm, accounts[0], 0);
        assertClose(fromWei(await farm.getPending(accounts[1])), 300);

        await deposit(farm, accounts[2], toWei(25000100));
        await farm.update();

        assertClose(fromWei(await farm.getPending(accounts[1])), 480);
        assertClose(fromWei(await farm.getPending(accounts[2])), 20);

    });


})


contract('Advanced Tests', accounts => {

    let farm;
    let rwt;
    let owner = accounts[0];
    let vault = accounts[1];
    let maxRewardsPerBlock = toWei(100);
    let fee = 0;
    let targetDailyCompoundRate = toWei(1.05);


    beforeEach(async () => {
        let TenBillion = toWei(10000000000)
        let OneBillion = toWei(1000000000)

        rwt = await Token.new(TenBillion, { from: owner })
        farm = await AutoCompound.new(rwt.address, vault, maxRewardsPerBlock, targetDailyCompoundRate, 
            fee, fee, { from: owner });

        for (let i = 0; i < 3; i++) {
            await rwt.increaseAllowance(farm.address, TenBillion, { from: accounts[i] });
            if (accounts[i] != owner) {
                await rwt.transfer(accounts[i], OneBillion, { from: owner });
            }
        }

    });

    it('should revert when there are not enough rewards', async () => {
        await deposit(farm, accounts[0], toWei(100000000));
        expectRevert(withdraw(farm, accounts[0], toWei(10000)), "Not enough rewards in contract.");
        expectRevert(claim(farm, accounts[0]), "Not enough rewards in contract.");
    });


})

// const advanceTime = (time) => {
//     return new Promise((resolve, reject) => {
//         web3.currentProvider.send({
//         jsonrpc: '2.0',
//         method: 'evm_increaseTime',
//         params: [time],
//         id: new Date().getTime()
//         }, (err, result) => {
//         if (err) { return reject(err) }
//         return resolve(result)
//         })
//     })
// }

// const advanceBlock = () => {
//     return new Promise((resolve, reject) => {
//         web3.currentProvider.send({
//         jsonrpc: '2.0',
//         method: 'evm_mine',
//         id: new Date().getTime()
//         }, (err, result) => {
//         if (err) { return reject(err) }
//         const newBlockHash = web3.eth.getBlock('latest').hash

//         return resolve(newBlockHash)
//         })
//     })
// }

// const advanceTimeAndBlock = async (time) => {
//     await advanceTime(time)
//     await advanceBlock()
//     return Promise.resolve(web3.eth.getBlock('latest'))
// }

// const mineBlocks = async (n) => {
//     for (let i = 0; i < n; i++) {
//         advanceTimeAndBlock(3);
//     }
// }
