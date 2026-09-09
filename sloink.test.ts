import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { expect, test } from "bun:test";
import { Hole, NamespaceResolver, SloinkError, unsloink, sloink } from "./sloink";

GlobalRegistrator.register();

const defaultResolver = new NamespaceResolver(globalThis as any);

function roundtrip<T>(obj: T, resolver: NamespaceResolver = defaultResolver): T {
    const s = sloink(obj, resolver);
    // console.log("serialized is", s);
    return unsloink(JSON.parse(JSON.stringify(s)), resolver) as T;
}

test("plain values", () => {
    expect(roundtrip(1)).toBe(1);
    expect(roundtrip(null)).toBeNull();
    expect(roundtrip(undefined)).toBeUndefined();
    expect(roundtrip("foo")).toBe("foo");
    expect(roundtrip(NaN)).toBeNaN();
    expect(roundtrip(Infinity)).toEqual(Infinity);
    expect(roundtrip(-Infinity)).toEqual(-Infinity);
});

test("basic", () => {
    const obj = { a: 1, b: 2, c: [1, 2, { d: 3 }], e: null, f: true };
    expect(roundtrip(obj)).toEqual(obj);
});

test("non-JSON atoms in an object", () => {
    const obj = { a: null, b: undefined, c: NaN, d: Infinity, e: -Infinity };
    expect(roundtrip(obj)).toEqual(obj);
});

test("circular references", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const roundtripped = roundtrip(obj);
    expect(roundtripped.self).toBe(roundtripped);
});

test("shared structure", () => {
    const obj = { a: 1, b: 2 };
    const arr = [obj, obj, { obj }] as const;
    const roundtripped = roundtrip(arr);
    expect(roundtripped).toEqual(arr);
    expect(roundtripped[0]).toBe(roundtripped[1]);
    expect(roundtripped[1]).toBe(roundtripped[2].obj);
});

test("Date, URL, RegExp, Map, Set, BigInt", () => {
    const obj = {
        date: new Date("2024-01-02T03:04:05Z"),
        url: new URL("https://example.com/path"),
        regex: /abc/gu,
        map: new Map([["a", 1]]),
        set: new Set([1, 2, 3]),
        bigint: 42n,
    };
    expect(roundtrip(obj)).toEqual(obj);
});

test("HTML", () => {
    const html = document.createElement("span");
    html.innerHTML = "<a href=foo>hi</a>";
    const roundtripped = roundtrip(html);
    expect(roundtripped).toBeInstanceOf(HTMLSpanElement);
    expect(roundtripped.firstChild).toBeInstanceOf(HTMLAnchorElement);
});

test("throws on function values", () => {
    const obj = { fn() { } };
    expect(() => roundtrip(obj)).toThrowError(new SloinkError("Can't sloink functions."));
});

test("can unsloink classes with cleanup true and false", () => {
    const ns = {
        Foo: class Foo {
            bar: number;
            constructor() {
                this.bar = 1;
                Foo.bax();
            }
            static bax() { }
        }
    };
    expect(roundtrip(new ns.Foo(), new NamespaceResolver(ns))).toBeInstanceOf(ns.Foo);
    expect(roundtrip(new ns.Foo(), new NamespaceResolver(ns))).toBeInstanceOf(ns.Foo);
});

test("unsloink and custom resolver", () => {
    class Dog {
        constructor(public loudness: number, public sound: string) { }
        woof() { return this.sound.repeat(this.loudness) + "!"; }
    }
    const obj = new Dog(3, "wow");
    const roundtripped = roundtrip(obj, new NamespaceResolver({ Dog }));
    expect(roundtripped).toBeInstanceOf(Dog);
    expect(roundtripped.woof()).toEqual("wowwowwow!");
});

test("unsloink/sloink works with minifier-renamed classes", () => {
    class z {
        constructor(public foo: number) { };
    }
    const obj = new z(1);
    const roundtripped = roundtrip(obj, new NamespaceResolver({ Foo: z }));
    expect(roundtripped).toBeInstanceOf(z);
});

test("can't sloink anonymous classes", () => {
    const obj = new class {
        foo = 1;
    };
    expect(() => roundtrip(obj)).toThrowError(new SloinkError("Can't sloink objects with anonymous constructors."));
});

test("can't sloink uninterned Symbols", () => {
    expect(roundtrip(Symbol.for("foo"))).toBe(Symbol.for("foo"));
    expect(roundtrip(Symbol.iterator)).toBe(Symbol.iterator);
    expect(() => roundtrip(Symbol("foo"))).toThrowError(new SloinkError("Can't sloink uninterned symbols."));
});

test("holes", () => {
    const value = { x: 1, y: 2, a: Symbol(234), b: Symbol("hi") };
    const serialized = sloink(value, defaultResolver, (_key, obj) => {
        if (typeof obj === "symbol") return new Hole(obj.description);
        return obj;
    });
    // console.log(serialized);
    expect(unsloink(serialized, defaultResolver, data => data + "_aaa")).toEqual({ x: 1, y: 2, a: "234_aaa", b: "hi_aaa" });
    expect(unsloink(serialized, defaultResolver, data => data + "_bbb")).toEqual({ x: 1, y: 2, a: "234_bbb", b: "hi_bbb" });
    expect(() => unsloink(serialized, defaultResolver)).toThrowError(new SloinkError("Data has holes but no hole filler provided."));
});

test("holes 2", () => {
    class Foo { constructor(public a: string, public b: string) { } }
    const value = { x: 1, y: 2, a: new Foo("a", "b"), b: new Foo("c", "d") };
    const serialized = sloink(value, defaultResolver, (_key, obj) => {
        if (obj instanceof Foo) return new Hole([obj.a, obj.b]);
        return obj;
    });
    // console.log(serialized);
    expect(unsloink(serialized, defaultResolver, ([data1, data2]) => `${data1}_1_${data2}`)).toEqual({ x: 1, y: 2, a: "a_1_b", b: "c_1_d" });
    expect(unsloink(serialized, defaultResolver, ([data1, data2]) => `${data1}_2_${data2}`)).toEqual({ x: 1, y: 2, a: "a_2_b", b: "c_2_d" });
});
