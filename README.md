# Sloink

*This started as what would have been version 3.0.0 of [resurrect-esm][], but the changes were so drastic I decided to make it a separate repository. Any similarity to resurrect-esm is intentional.*

Sloink preserves object behavior (prototypes) and reference
circularity with a special JSON encoding. Unlike flat JSON, it can
also properly unsloink these types of values:

* Date [^1]
* Map [^1]
* Set [^1]
* URL [^1]
* RegExp [^1]
* HTML elements
* Interned and well-known Symbols
* `undefined`
* NaN, Infinity, -Infinity'

Uninterned symbols and functions can never be serialized and will always throw an error.

[^1]: Subclasses of these will be silently converted to the un-subclassed one.

[resurrect-esm]: https://github.com/dragoncoder047/resurrect-esm

## API overview

* `sloink(object[, resolver[, replacer]])`: Serializes an arbitrary object or value into a JSON'able representation.
    * The `resolver` is an object used to find the prototypes of objects to be able to restore behavior (see below).
    * The `replacer` is called the same way as with [JSON.stringify][json-mdn]. If it returns `undefined` the key will be deleted. If it returns a `Hole`, it will turn the JSON into a [template](#holes) that can have the Hole values filled dynamically at unsloink-time.

* `unsloink(json[, resolver[, holeFiller]])`: Deserializes an object stored in a JSON representation created by a previous call to `sloink()`. Circularity and behavior (prototype chain) will be restored.
    * The `resolver` is the same as with `sloink()` (you should use the same setup for both).
    * The `holeFiller` is a function that will be called for every [hole](#holes). Required if there are holes.

* `Hole` - Wrapper used to create places that are dynamically filled with a computed value at unsloink-time.
* `NamespaceResolver` - Used to resolve constructors and builders
* `unsloinkError` - Thrown when a problem occurs

[json-mdn]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify

## Example

```ts
import { NamespaceResolver, sloink, unsloink } from "sloink";

class Dog {
  constructor(public sound: string) { }
  bark() {
    return this.sound.toUpperCase();
  }
}

const resolver = new NamespaceResolver({ Dog });
const original = { pet: new Dog("woof") };

const payload = JSON.stringify(sloink(original, resolver));
// payload can now be JSON.stringified and saved to disk,
// sent over the network, etc...
const revived = unsloink(JSON.parse(payload), resolver);

console.log(revived.pet instanceof Dog); // true
console.log(revived.pet.bark()); // WOOF

// References to the same objects will be preserved:
const obj = {};
const payload = JSON.stringify(sloink([obj, obj], resolver));
const revived = unsloink(JSON.parse(payload), resolver);
console.log(revived[0] === revived[1]); // true

// Circular references are preserved:
const obj = {};
obj.self = obj;
const payload = JSON.stringify(sloink(obj, resolver));
const revived = unsloink(JSON.parse(payload), resolver);
console.log(revived === revived.self); // true
```

## Resolver

The `resolver` tells the serializer how to map constructor names back to their actual constructors. For simple classes, you can use a `NamespaceResolver`:

```ts
const resolver = new NamespaceResolver({ Foo, Bar });
```

If your objects have hidden state, or if you have a different resolution method, you can create your own subclass of `Resolver`. (See [**Builders**](#builders) below).

> [!CAUTION]
> If you're using ES6 modules for your custom classes, you MUST use an explicit resolver (namespace or custom) since module scope is not global scope!

`NamespaceResolver` will always use the name on the namespace object of whatever you pass in instead of the `.name` of the object's constructor. This is to better support minifiers that rename the class and produce code output similar to this:

```ts
import { sloink as s, NamespaceResolver as e } from "sloink";
var c = class d {
    constructor() {
        this.bar = true;
        d.bax(this);
    }
    static bax(obj) {
    }
};
var m = new e({
    Foo: c, // <== Always uses name given here
});
var a = s(someObj, m);
```

In the serializer above, the "name" given to the class will always be `Foo`, even though the `.name` of the constructor is `c` and might be different on the next build.

If the constructor cannot be resolved, serialization will throw a `unsloinkError`.

### Well-known types

The resolver will not be called for:

* Date
* URL
* RegExp
* Map
* Set
* BigInt
* NaN / Infinity / -Infinity
* DOM elements

## Builders

A `Resolver` is how the serializer knows how to rebuild values that are not plain objects or the built-in special cases. The default `NamespaceResolver` is enough for most classes, but if an object stores hidden state or your constructors are not discoverable from a simple namespace lookup, you can provide a custom resolver that implements the builder hooks.

The builder hooks are:

* `toBuilder(obj)`: returns a 2-tuple `[typeName, args]` when a value needs custom reconstruction, or `null` when the object can be serialized as-is. (`NamespaceResolver` simply returns `null` for everything.)
* `build(typeName, args)`: turns the stored type name and constructor args back into an instance.

This is used for cases where the original value does not expose all of its state through enumerable own properties. A typical example is a class with private fields or internal caches:

```ts
import { NamespaceResolver, sloink, unsloink } from "sloink";

class Counter {
    #value: number;
    constructor(value = 0) { this.#value = value; }
    inc() { return ++this.#value; }
}

class CounterResolver extends NamespaceResolver {
    toBuilder(obj: unknown) {
        if (obj instanceof Counter) {
            // The private field is not enumerable, so we store the real value
            // explicitly.
            // Unfortunately there's no way to get it without mutating
            // the object's internal state.
            return ["Counter", [obj.inc() - 1]];
        }
        // more cases as needed
        return null;
    }
    build(typeName: string, args: any[]) {
        if (typeName === "Counter") return new Counter(args[0]);
        // more cases as needed
    }
}

const counter = new Counter(7);
const payload = sloink(counter, new CounterResolver());
const revived = unsloink(payload, new CounterResolver());

console.log(revived instanceof Counter); // true
console.log(revived.inc()); // 8
```

&rarr; `toBuilder()` describes the minimum data needed to recreate the object, while `build()` performs the actual construction step.

## Holes

A `Hole` is a placeholder for a value that should be filled later during deserialization instead of being serialized literally. This is useful when the actual value depends on runtime state, a database lookup, or some other data that is only known when the payload is being revived.

The pattern is:

1. During `sloink()`, your `replacer` returns `new Hole(data)` for the value that should be deferred.
2. The serializer records the hole data in the payload.
3. During `unsloink()`, you provide a `holeFiller(data)` callback that receives that stored data and returns the final value.

Example:

```ts
import { Hole, sloink, unsloink } from "sloink";

const obj = {
    userId: 42,
    profile: someObject,
};

const payload = sloink(obj, new NamespaceResolver({}), (key, value) => {
    if (key === "profile") {
        return new Hole({ type: "user", id: value.userId });
    }
    return value;
});

const revived = unsloink(payload, new NamespaceResolver({}), holeData => {
    return getFromDB(holeData.type, holeData.id);
});

console.log(revived.profile); // fresh from DB
```

A hole is not a real object value; it is a deferred marker. If a hole is present and you do not pass a `holeFiller` to `unsloink()`, it will throw an error.
