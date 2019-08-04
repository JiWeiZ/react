/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint valid-typeof: 0 */

import invariant from 'shared/invariant';

// ================================================================================
// Event 事件接口
/**
 * @interface Event
 * @see http://www.w3.org/TR/DOM-Level-3-Events/
 */
const EventInterface = {
  type: null,
  target: null,
  // currentTarget is set when dispatching; no use in copying it here
  currentTarget: function() {
    return null;
  },
  eventPhase: null,
  bubbles: null,
  cancelable: null,
  timeStamp: function(event) {
    return event.timeStamp || Date.now();
  },
  defaultPrevented: null,
  isTrusted: null,
};
// ================================================================================


function functionThatReturnsTrue() {
  return true;
}

function functionThatReturnsFalse() {
  return false;
}

/**
 * Synthetic events are dispatched by event plugins, typically in response to a
 * top-level event delegation handler.
 *
 * These systems should generally use pooling to reduce the frequency of garbage
 * collection. The system should check `isPersistent` to determine whether the
 * event should be released into the pool after being dispatched. Users that
 * need a persisted event should invoke `persist`.
 *
 * Synthetic events (and subclasses) implement the DOM Level 3 Events API by
 * normalizing browser quirks. Subclasses do not necessarily have to implement a
 * DOM interface; custom application-specific events can also subclass this.
 *
 * 合成事件是通过事件插件派发的，通常合成事件用来响应顶层的事件代理（一般是document上的事件代理）
 *
 * 这些系统应该使用池化去减少垃圾回收的频率。系统应该检查 `isPersistent` 然后确定当前事件在派发
 * 之后是否需要从池子中释放掉。 需要持久化某个事件应该调用`persist`。
 *
 * 合成事件（和子类）通过规范化浏览器差异实现了DOM Level 3 Events API。 子类不一定要实现DOM接
 * 口; 自定义的针对特定应用的事件也可以继承合成事件。
 *
 * @param {object} dispatchConfig Configuration used to dispatch this event. 派发配置
 * @param {*} targetInst Marker identifying the event target. 事件目标，event target，应该是虚拟dom
 * @param {object} nativeEvent Native browser event. 浏览器原生事件
 * @param {DOMEventTarget} nativeEventTarget Target node. 原生的DOM node
 */
function SyntheticEvent(
  dispatchConfig,
  targetInst,
  nativeEvent,
  nativeEventTarget,
) {
  this.dispatchConfig = dispatchConfig;
  this._targetInst = targetInst;
  this.nativeEvent = nativeEvent;

  // ================================================================================
  // 将原生事件的属性挂到合成事件上

  // 现在看来这个Interface就是上面的 EventInterface
  // 对比原生事件的event接口，实验性质和非标准的接口都未实现
  const Interface = this.constructor.Interface;
  for (const propName in Interface) {
    // 只处理Interface的自身属性
    if (!Interface.hasOwnProperty(propName)) {
      continue;
    }

    const normalize = Interface[propName];
    if (normalize) {
      // 如果 normalize 存在的话是一个函数，参见上面的 EventInterface
      // 实际上现在就是给合成事件加个时间戳，然后currentTarget置为null
      this[propName] = normalize(nativeEvent);
    } else {
      if (propName === 'target') {
        this.target = nativeEventTarget;
      } else {
        this[propName] = nativeEvent[propName];
      }
    }
  }
  // ================================================================================

  // ================================================================================
  // 挂2个属性isDefaultPrevented和isPropagationStopped
  // 前者屏蔽defaultPrevented和returnValue的差异
  // 后者默认false
  const defaultPrevented =
    nativeEvent.defaultPrevented != null
      ? nativeEvent.defaultPrevented
      : nativeEvent.returnValue === false;
  if (defaultPrevented) {
    this.isDefaultPrevented = functionThatReturnsTrue;
  } else {
    this.isDefaultPrevented = functionThatReturnsFalse;
  }
  this.isPropagationStopped = functionThatReturnsFalse;
  // ================================================================================

  return this;
}

Object.assign(SyntheticEvent.prototype, {
  preventDefault: function() {
    this.defaultPrevented = true;
    const event = this.nativeEvent;
    if (!event) {
      return;
    }

    if (event.preventDefault) {
      event.preventDefault();
    } else if (typeof event.returnValue !== 'unknown') {
      // IE7 返回 "unknown" 而不是 "undefined"
      event.returnValue = false;
    }
    this.isDefaultPrevented = functionThatReturnsTrue;
  },

  stopPropagation: function() {
    const event = this.nativeEvent;
    if (!event) {
      return;
    }

    if (event.stopPropagation) {
      event.stopPropagation();
    } else if (typeof event.cancelBubble !== 'unknown') {
      // The ChangeEventPlugin registers a "propertychange" event for
      // IE. This event does not support bubbling or cancelling, and
      // any references to cancelBubble throw "Member not found".  A
      // typeof check of "unknown" circumvents this issue (and is also
      // IE specific).
      //
      // ChangeEventPlugin 为 IE 注册了一个 propertychange 事件。该事件不支
      // 持冒泡或取消，此外任何对cancelBubble的引用都会抛出"Member not found"
      // 的异常。检查 IE 独有的 typeof 'unknown' 规避了这个问题
      event.cancelBubble = true;
    }

    this.isPropagationStopped = functionThatReturnsTrue;
  },

  /**
   * We release all dispatched `SyntheticEvent`s after each event loop, adding
   * them back into the pool. This allows a way to hold onto a reference that
   * won't be added back into the pool.
   *
   * 每次事件循环之后我们都会将已经派发出去的合成事件从事件池中释放，然后再添加回池子。
   * persist 方法能够让我们有机会将某个不会再被添加到池子里的引用给保存下来
   */
  persist: function() {
    this.isPersistent = functionThatReturnsTrue;
  },

  /**
   * Checks if this event should be released back into the pool.
   * 检查某个事件是不是持久化了的。默认不是
   *
   * @return {boolean} True if this should not be released, false otherwise.
   */
  isPersistent: functionThatReturnsFalse,

  /**
   * `PooledClass` looks for `destructor` on each instance it releases.
   * `PooledClass` 会调用事件实例上的 `destructor` 方法释放该实例
   */
  destructor: function() {
    const Interface = this.constructor.Interface;
    for (const propName in Interface) {
      this[propName] = null;
    }
    this.dispatchConfig = null;
    this._targetInst = null;
    this.nativeEvent = null;
    this.isDefaultPrevented = functionThatReturnsFalse;
    this.isPropagationStopped = functionThatReturnsFalse;
    this._dispatchListeners = null;
    this._dispatchInstances = null;
  },
});

SyntheticEvent.Interface = EventInterface;

/**
 * Helper to reduce boilerplate when creating subclasses.
 * 构建子类的辅助方法。
 *
 */
SyntheticEvent.extend = function(Interface) {
  const Super = this;

  // ================================================================================
  // Object.create 的 polyfill
  // ES6的写法：
  // const prototype = Object.create(Super.prototype)

  const E = function() {};
  E.prototype = Super.prototype;
  const prototype = new E();
  // ================================================================================

  function Class() {
    return Super.apply(this, arguments);
  }
  Object.assign(prototype, Class.prototype);

  Class.prototype = prototype;
  Class.prototype.constructor = Class;

  Class.Interface = Object.assign({}, Super.Interface, Interface);
  Class.extend = Super.extend;

  // 给事件构造器添加池化功能
  addEventPoolingTo(Class);

  return Class;
};

// ================================================================================
// 池化相关
const EVENT_POOL_SIZE = 10;

/**
 * Helper to nullify syntheticEvent instance properties when destructing
 *
 * @param {String} propName
 * @param {?object} getVal
 * @return {object} defineProperty object
 */

function getPooledEvent(dispatchConfig, targetInst, nativeEvent, nativeInst) {
  // 池子非空就从池子取出一个对象，否则调用构造函数实例化
  const EventConstructor = this;
  if (EventConstructor.eventPool.length) {
    const instance = EventConstructor.eventPool.pop();
    EventConstructor.call(
      instance,
      dispatchConfig,
      targetInst,
      nativeEvent,
      nativeInst,
    );
    return instance;
  }
  return new EventConstructor(
    dispatchConfig,
    targetInst,
    nativeEvent,
    nativeInst,
  );
}

function releasePooledEvent(event) {
  const EventConstructor = this;
  invariant(
    event instanceof EventConstructor,
    'Trying to release an event instance into a pool of a different type.',
  );
  // 释放event实例
  event.destructor();
  // 若当前事件池未满，入池
  if (EventConstructor.eventPool.length < EVENT_POOL_SIZE) {
    EventConstructor.eventPool.push(event);
  }
}

function addEventPoolingTo(EventConstructor) {
  // 用于池化的的3个静态属性
  EventConstructor.eventPool = [];
  EventConstructor.getPooled = getPooledEvent;
  EventConstructor.release = releasePooledEvent;
}
// ================================================================================

// 给事件构造器添加池化功能
addEventPoolingTo(SyntheticEvent);

export default SyntheticEvent;
