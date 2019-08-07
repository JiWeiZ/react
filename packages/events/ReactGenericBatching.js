/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  needsStateRestore,
  restoreStateIfNeeded,
} from './ReactControlledComponent';

// Used as a way to call batchedUpdates when we don't have a reference to
// the renderer. Such as when we're dispatching events or if third party
// libraries need to call batchedUpdates. Eventually, this API will go away when
// everything is batched by default. We'll then have a similar API to opt-out of
// scheduled work and instead do synchronous work.

// 无法引用renderer的时候能调用 batchedUpdates
// 啥时候会需要在无法引用renderer的时候调用 batchedUpdates 呢？
//    1. 派发事件的时候
//    2. 第三方库需要调用 batchedUpdates
// 这些 API 是暂时性的，等 react 把所有的东西都默认搞成 batch 的了就丢掉了
// 以后会提供API让用户有能力选择退出 scheduled work 而去执行 synchronous work

// Defaults
let _batchedUpdatesImpl = function(fn, bookkeeping) {
  return fn(bookkeeping);
};
let _interactiveUpdatesImpl = function(fn, a, b) {
  return fn(a, b);
};
let _flushInteractiveUpdatesImpl = function() {};

let isBatching = false;
export function batchedUpdates(fn, bookkeeping) {
  if (isBatching) {
    // If we are currently inside another batch, we need to wait until it
    // fully completes before restoring state.
    // 如果当前我们在另一个batch过程中，就得等整个更新完成才能恢复状态
    return fn(bookkeeping);
  }
  isBatching = true;
  try {
    return _batchedUpdatesImpl(fn, bookkeeping);
  } finally {
    // Here we wait until all updates have propagated, which is important
    // when using controlled components within layers:
    // https://github.com/facebook/react/issues/1698
    // Then we restore state of any controlled component.

    // 先得让updates全部propagate了，然后才恢复受控组件的状态
    isBatching = false;
    const controlledComponentsHavePendingUpdates = needsStateRestore();
    if (controlledComponentsHavePendingUpdates) {
      // If a controlled event was fired, we may need to restore the state of
      // the DOM node back to the controlled value. This is necessary when React
      // bails out of the update without touching the DOM.

      // 受控事件触发以后，我们要有能力恢复DOM节点的状态（比如input的value）
      // （何时需要恢复呢？）
      // 这在React不触及DOM的情况下退出更新是必须的（啥意思？）
      _flushInteractiveUpdatesImpl();
      restoreStateIfNeeded();
    }
  }
}

export function interactiveUpdates(fn, a, b) {
  return _interactiveUpdatesImpl(fn, a, b);
}

export function flushInteractiveUpdates() {
  return _flushInteractiveUpdatesImpl();
}

export function setBatchingImplementation(
  batchedUpdatesImpl,
  interactiveUpdatesImpl,
  flushInteractiveUpdatesImpl,
) {
  _batchedUpdatesImpl = batchedUpdatesImpl;
  _interactiveUpdatesImpl = interactiveUpdatesImpl;
  _flushInteractiveUpdatesImpl = flushInteractiveUpdatesImpl;
}
