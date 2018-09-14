/*
 * Copyright (c) 2018, Gnock
 * Copyright (c) 2018, The Masari Project
 * Copyright (c) 2018, The TurtleCoin Project
 * Copyright (c) 2018, The Karbo Project
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

import { Transaction, TransactionIn, TransactionOut } from "./Transaction";
import { KeysRepository, UserKeys } from "./KeysRepository";
import { Observable } from "../lib/numbersLab/Observable";
import { CryptoUtils } from "./CryptoUtils";

export type RawWalletOptions = {
    checkMinerTx?: boolean,
    readSpeed: number,
}

export class WalletOptions {
    checkMinerTx: boolean = false;
    readSpeed: number = 10;

    static fromRaw(raw: RawWalletOptions) {
        let options = new WalletOptions();

        if (typeof raw.checkMinerTx !== 'undefined') options.checkMinerTx = raw.checkMinerTx;
        if (typeof raw.readSpeed !== 'undefined') options.readSpeed = raw.readSpeed;

        return options;
    }

    exportToJson(): RawWalletOptions {
        let data: RawWalletOptions = {
            readSpeed: this.readSpeed,
            checkMinerTx: this.checkMinerTx
        };
        return data;
    }
}


export type RawWallet = {
    transactions: any[],
    lastHeight: number,
    encryptedKeys?: string | Array<number>,
    nonce: string,
    keys?: UserKeys,
    creationHeight?: number,
    options?: RawWalletOptions
}

export class Wallet extends Observable {
    // lastHeight : number = 114000;
    // lastHeight : number = 75900;
    // private _lastHeight : number = 50000;
    private _lastHeight: number = 0;

    private transactions: Transaction[] = [];
    txsMem: Transaction[] = [];
    private modified = true;
    creationHeight: number = 0;

    keys !: UserKeys;

    private _options: WalletOptions = new WalletOptions();

    exportToRaw(includeKeys = false): RawWallet {
        let transactions: any[] = [];
        for (let transaction of this.transactions) {
            transactions.push(transaction.export());
        }

        let data: RawWallet = {
            transactions: transactions,
            lastHeight: this._lastHeight,
            nonce: '',
            options: this._options
        };

        if (includeKeys) {
            data.keys = this.keys;
        } else {
            if (this.keys.priv.spend !== '')
                data.encryptedKeys = this.keys.priv.view + this.keys.priv.spend;
            else
                data.encryptedKeys = this.keys.priv.view + this.keys.pub.view + this.keys.pub.spend;
        }

        if (this.creationHeight !== 0) data.creationHeight = this.creationHeight;

        return data;
    }

    static loadFromRaw(raw: RawWallet, includeKeys = false): Wallet {
        let wallet = new Wallet();
        wallet.transactions = [];
        for (let rawTransac of raw.transactions) {
            wallet.transactions.push(Transaction.fromRaw(rawTransac));
        }
        wallet._lastHeight = raw.lastHeight;
        if (typeof raw.encryptedKeys === 'string') {
            if (raw.encryptedKeys.length === 128) {
                let privView = raw.encryptedKeys.substr(0, 64);
                let privSpend = raw.encryptedKeys.substr(64, 64);
                wallet.keys = KeysRepository.fromPriv(privSpend, privView);
            } else {
                let privView = raw.encryptedKeys.substr(0, 64);
                let pubViewKey = raw.encryptedKeys.substr(64, 64);
                let pubSpendKey = raw.encryptedKeys.substr(128, 64);

                wallet.keys = {
                    pub: {
                        view: pubViewKey,
                        spend: pubSpendKey
                    },
                    priv: {
                        view: privView,
                        spend: '',
                    }
                };
            }
        }
        if (includeKeys && typeof raw.keys !== 'undefined') {
            wallet.keys = raw.keys;
        }
        if (typeof raw.creationHeight !== 'undefined') wallet.creationHeight = raw.creationHeight;

        if (typeof raw.options !== 'undefined') wallet._options = WalletOptions.fromRaw(raw.options);

        wallet.recalculateKeyImages();
        return wallet;
    }

    isViewOnly() {
        return this.keys.priv.spend === '';
    }

    get lastHeight(): number {
        return this._lastHeight;
    }

    set lastHeight(value: number) {
        let modified = value !== this._lastHeight;
        this._lastHeight = value;
        if (modified) this.notify();
    }

    get options(): WalletOptions {
        return this._options;
    }

    set options(value: WalletOptions) {
        this._options = value;
        this.modified = true;
    }

    getAll(forceReload = false): Transaction[] {
        return this.transactions.slice();
    }

    getAllOuts(): TransactionOut[] {
        let alls = this.getAll();
        let outs: TransactionOut[] = [];
        for (let tr of alls) {
            outs.push.apply(outs, tr.outs);
        }
        return outs;
    }

    addNew(transaction: Transaction, replace = true) {
        let exist = this.findWithTxPubKey(transaction.txPubKey);
        if (!exist || replace) {
            if (!exist) {
                this.transactions.push(transaction);
            }
            else
                for (let tr = 0; tr < this.transactions.length; ++tr)
                    if (this.transactions[tr].txPubKey === transaction.txPubKey) {
                        this.transactions[tr] = transaction;
                    }

            // this.saveAll();
            this.recalculateKeyImages();
            this.modified = true;
            this.notify();
        }
    }

    findWithTxPubKey(pubKey: string): Transaction | null {
        for (let tr of this.transactions)
            if (tr.txPubKey === pubKey)
                return tr;
        return null;
    }

    getTransactionKeyImages() {
        return this.keyImages;
    }

    getTransactionOutIndexes() {
        return this.txOutIndexes;
    }

    getOutWithGlobalIndex(index: number): TransactionOut | null {
        for (let tx of this.transactions) {
            for (let out of tx.outs) {
                if (out.globalIndex === index)
                    return out;
            }
        }
        return null;
    }

    getCorrespondingOut(index: number, hash: string): TransactionOut | null {
        //find a corresponding output by Tx hash and "number" (index in Tx)
        for (let tx of this.transactions) {
            if (tx.hash === hash) {
                for (let out of tx.outs) {
                    if (out.outputIdx === index) {
                        return out;
                    }
                }
            }
        }
        return null;
    }

    private keyImages: string[] = [];
    private txOutIndexes: number[] = [];
    private recalculateKeyImages() {
        let keys: string[] = [];
        let indexes: number[] = [];
        for (let transaction of this.transactions) {
            for (let out of transaction.outs) {
                if (out.keyImage !== null && out.keyImage !== '')
                    keys.push(out.keyImage);
                if (out.globalIndex !== 0)
                    indexes.push(out.globalIndex);
            }
        }
        this.keyImages = keys;
        this.txOutIndexes = indexes;
    }

    getTransactionsCopy(): Transaction[] {
        let news = [];
        for (let transaction of this.transactions) {
            news.push(Transaction.fromRaw(transaction.export()));
        }
        return news;
    }

    get amount(): number {
        return this.unlockedAmount(-1);
    }

    unlockedAmount(currentBlockHeight: number = -1): number {
        //TODO: fix the display of unlocked balances vs total

        let amount = 0;
        for (let transaction of this.transactions) {
            if (!transaction.isFullyChecked())
                continue;

            if (transaction.isFusionTx()) {
                //Handle what we do with fusion Tx's
                //this needs to be something like:
                //tx's that are still locked up in fusion should display as "locked" balance, 
                //only if it's been "cleared", then we should see it in "unlocked" balance
            }

            // if(transaction.ins.length > 0){
            // 	amount -= transaction.fees;
            // }
            if (transaction.isConfirmed(currentBlockHeight) || currentBlockHeight === -1)
                for (let out of transaction.outs) {
                    amount += out.amount;
                }
            for (let nin of transaction.ins) {
                amount -= nin.amount;
            }
        }

        for (let transaction of this.txsMem) {
            // console.log(transaction.paymentId);
            // for(let out of transaction.outs){
            // 	amount += out.amount;
            // }
            if (transaction.isConfirmed(currentBlockHeight) || currentBlockHeight === -1)
                for (let nout of transaction.outs) {
                    amount += nout.amount;
                    // console.log('+'+nout.amount);
                }

            for (let nin of transaction.ins) {
                amount -= nin.amount;
                // console.log('-'+nin.amount);
            }
        }


        return amount;
    }

    hasBeenModified() {
        return this.modified;
    }

    getPublicAddress() {
        return cnUtil.pubkeys_to_string(this.keys.pub.spend, this.keys.pub.view);
    }

    recalculateIfNotViewOnly() {
        if (!this.isViewOnly()) {
            for (let tx of this.transactions) {
                let needDerivation = false;
                for (let out of tx.outs) {
                    if (out.keyImage === '') {
                        needDerivation = true;
                        break;
                    }
                }

                if (needDerivation) {
                    let derivation = '';
                    try {
                        derivation = cnUtil.generate_key_derivation(tx.txPubKey, this.keys.priv.view);//9.7ms
                    } catch (e) {
                        continue;
                    }
                    for (let out of tx.outs) {
                        if (out.keyImage === '') {
                            let m_key_image = CryptoUtils.generate_key_image_helper({
                                view_secret_key: this.keys.priv.view,
                                spend_secret_key: this.keys.priv.spend,
                                public_spend_key: this.keys.pub.spend,
                            }, tx.txPubKey, out.outputIdx, derivation);

                            out.keyImage = m_key_image.key_image;
                            this.modified = true;
                        }
                    }
                }
            }

            if (this.modified)
                this.recalculateKeyImages();

            for (let iTx = 0; iTx < this.transactions.length; ++iTx) {
                for (let iIn = 0; iIn < this.transactions[iTx].ins.length; ++iIn) {
                    let input = this.transactions[iTx].ins[iIn];

                    if (input.amount < 0) {
                        if (this.keyImages.indexOf(input.keyImage) != -1) {
                            // console.log('found in', vin);
                            let walletOuts = this.getAllOuts();
                            for (let ut of walletOuts) {
                                if (ut.keyImage == input.keyImage) {
                                    this.transactions[iTx].ins[iIn].amount = ut.amount;
                                    this.transactions[iTx].ins[iIn].keyImage = ut.keyImage;

                                    this.modified = true;
                                    break;
                                }
                            }
                        } else {
                            this.transactions[iTx].ins.splice(iIn, 1);
                            --iIn;
                        }
                    }
                }

                if (this.transactions[iTx].outs.length === 0 && this.transactions[iTx].ins.length === 0) {
                    this.transactions.splice(iTx, 1);
                    --iTx;
                }
            }

        }
    }

}