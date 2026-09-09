/**
 * Sloink, an object serialization library inspired by unsloink.js
 * @version 3.0.0
 * @license AGPLv3
 */

import { isArray } from "lib0/array";
import { isNumber } from "lib0/function";
import { keys } from "lib0/object";

export class SloinkError extends Error { }

const is = <T>(type: string) => {
    const string = `[object ${type}]`;
    return (obj: any): obj is T => ({}.toString.call(obj) === string);
}

const isBoolean = is<boolean>("Boolean");
const isBigInt = is<bigint>("BigInt");
const isFunction = is<Function>("Function");
const isDate = is<Date>("Date");
const isURL = is<URL>("URL");
const isRegExp = is<RegExp>("RegExp");
const isString = is<string>("String");
const isSet = is<Set<unknown>>("Set");
const isMap = is<Map<unknown, unknown>>("Map");
const isSymbol = is<symbol>("Symbol");

const isJSONAtom = (object: any): object is string | number | boolean | null => {
    return isString(object) || (isNumber(object) && !(isNaN(object) || !isFinite(object))) || isBoolean(object) || object === null;
}
const isPrimitive = (object: any) => {
    return object == null ||
        isNumber(object) ||
        isString(object) ||
        isBoolean(object);
}

const parseHTML = (html: string) => {
    const a = document.createElement("a");
    a.innerHTML = html;
    return a.firstChild as HTMLElement;
}

export abstract class Resolver {
    /**
     * Returns a builder (args to give to a constructor function if the
     * object has hidden state and must be initialized) or null if all the
     * enumerable keys hold the state
     */
    toBuilder(obj: any): [string, any[]] | null {
        return null;
    }
    /**
     * Reverse of {@link toBuilder}, constructs the object from the arguments.
     */
    build(typeName: string, args: any[]) {
        const type = this.getConstructor(typeName);
        // Special case for BigInt since it's not an object but not JSONable
        if (type === (BigInt as any)) return BigInt(args[0]);
        // Brilliant hack by kybernetikos
        const result: any = new (type.bind.apply(type, [null].concat(args) as [any, any[]]))();
        return isPrimitive(result) ? result.valueOf() : result;
    }
    /**
     * Gets the prototype of the given property name from an object.
     * Should throw an error if not found.
     */
    abstract getPrototype(name: string): any;
    /**
     * Gets the prototype name for an object, to be fetched later with
     * {@link getPrototype} and {@link getConstructor}.
     * @returns null if the constructor is `Object` or `Array`.
     */
    abstract getConstructorName(object: object): string | null;
    /**
     * Get the constructor function for the object prototype name.
     */
    abstract getConstructor(name: string): new (...args: any[]) => any;
}

export class NamespaceResolver extends Resolver {
    constructor(public scope: Record<string, new (...args: any[]) => any>) { super(); }
    getPrototype(name: string): any {
        const constructor = this.scope[name];
        if (constructor) {
            return constructor.prototype;
        }
        throw new SloinkError("Unknown constructor: " + name);
    }
    getConstructorName(object: object): string | null {
        const constructorFun = object.constructor;
        let constructor = keys(this.scope).find(realName => this.scope[realName] === constructorFun) ?? constructorFun.name;
        if (constructor == null) { // IE
            constructor = /^\s*function\s*([A-Za-z0-9_$]*)/.exec("" + constructorFun)?.[1] ?? "";
        }
        if (constructor === "") {
            throw new SloinkError("Can't sloink objects with anonymous constructors.");
        }
        return constructor === "Object" || constructor === "Array" ? null : constructor;
    }
    getConstructor(name: string): new (...args: any[]) => any {
        return (this.scope[name] ?? name.split(/\./).reduce((object, name) => {
            return (object as any)[name];
        }, globalThis)) as unknown as new () => any;
    }
}

enum Opcode {
    RESULT, // resultIndex,
    PROPERTY, // targetIndex, keyIndex, valueIndex
    PUSH_ARRAY_ITEM, // targetIndex, itemIndex
    BUILD_KNOWN, // targetIndex, typecodeIndex, argc, ...argvIndices
    BUILD_OTHER, // targetIndex, typecodeIndex, argc, ...argvIndices
    FIX_PROTO, // targetIndex, protocodeIndex
    FILL_HOLE, // targetIndex, holeDataIndex
}

export class Hole { constructor(public data: any) { } }

export type Replacer = (this: any, key: string | number, obj: any) => any;
export type HoleFiller = (holeData: any) => any;

// standard base64 alphabet
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const reverse_alphabet = new Map([...alphabet].map((c, i) => [c, BigInt(i)]));
const zigzag = (x: bigint) => x >= 0n ? x << 1n : (-x << 1n) - 1n;
const zigzagInv = (x: bigint) => x & 1n ? -((x >> 1n) + 1n) : x >> 1n;
const encodeCmds = (array: number[]): string => {
    var out = "";
    for (var el of array) {
        var n = zigzag(BigInt(el));
        do {
            // Grab 5 bits
            const chunk = Number(n & 31n);
            n >>= 5n;
            out += alphabet[(n > 0n ? 32 : 0) + chunk];
        } while (n > 0n);
    }
    return out;
}
const decodeCmds = (string: string): number[] => {
    const out = [];
    for (var i = 0; i < string.length;) {
        var value = 0n, token, shift = 0n;
        do {
            token = reverse_alphabet.get(string.charAt(i)!)!;
            value |= (token & 31n) << shift;
            i++;
            shift += 5n;
        } while (token & 32n);
        out.push(Number(zigzagInv(value)));
    }
    return out;
}

enum KnownBuildType {
    MAP,
    SET,
    HTML,
    DATE,
    URL,
    REGEX,
    INFINITY,
    NAN,
    BIGINT,
    INTERNED_SYMBOL,
    WELL_KNOWN_SYMBOL,
}

const toKnownBuilder = (obj: any): [typecode: KnownBuildType, argv: any[]] | null => {
    if (isFunction(obj)) {
        throw new SloinkError("Can't sloink functions.");
    } else if (isMap(obj)) {
        return [KnownBuildType.MAP, [...obj.entries()]];
    } else if (isSet(obj)) {
        return [KnownBuildType.SET, [...obj.values()]];
    } else if (obj instanceof Node) {
        return [KnownBuildType.HTML, [new XMLSerializer().serializeToString(obj)]];
    } else if (isDate(obj)) {
        return [KnownBuildType.DATE, [obj.toISOString()]];
    } else if (isURL(obj)) {
        return [KnownBuildType.URL, [obj.href]];
    } else if (isRegExp(obj)) {
        return [KnownBuildType.REGEX, [obj.source, obj.flags]];
    } else if (isNumber(obj) && (isNaN(obj) || !isFinite(obj))) {
        return isNaN(obj) ? [KnownBuildType.NAN, []] : [KnownBuildType.INFINITY, [obj > 0]];
    } else if (isBigInt(obj)) {
        return [KnownBuildType.BIGINT, ["" + obj]];
    } else if (isSymbol(obj)) {
        const key = Symbol.keyFor(obj);
        if (key === undefined) {
            const key2 = Reflect.ownKeys(Symbol).find(s => { const s2 = Symbol[s as keyof SymbolConstructor]; return isSymbol(s2) && s2 === obj; });
            if (key2 === undefined) {
                throw new SloinkError("Can't sloink uninterned symbols.");
            }
            return [KnownBuildType.WELL_KNOWN_SYMBOL, [key2]];
        }
        return [KnownBuildType.INTERNED_SYMBOL, [key]];
    } else {
        return null;
    }
}

const buildKnown = (typecode: KnownBuildType, argv: any[]) => {
    switch (typecode) {
        case KnownBuildType.MAP: return new Map(argv);
        case KnownBuildType.SET: return new Set(argv);
        case KnownBuildType.HTML: return parseHTML(argv[0]);
        case KnownBuildType.DATE: return new Date(argv[0]);
        case KnownBuildType.URL: return new URL(argv[0]);
        case KnownBuildType.REGEX: return new RegExp(argv[0], argv[1]);
        case KnownBuildType.INFINITY: return argv[0] ? Infinity : -Infinity;
        case KnownBuildType.NAN: return NaN;
        case KnownBuildType.BIGINT: return BigInt(argv[0]);
        case KnownBuildType.INTERNED_SYMBOL: return Symbol.for(argv[0]);
        case KnownBuildType.WELL_KNOWN_SYMBOL: return Symbol[argv[0] as keyof SymbolConstructor];
        default:
            typecode satisfies never;
            throw new SloinkError("unknown build opcode");
    }
}

class Reference {
    constructor(public index: number) { }
    count = 1;
}

export const sloink = (root: any, resolver: Resolver = new NamespaceResolver({}), replacer?: Replacer) => {
    const table: any[] = [,]; // placeholder for command string
    const indices = new Map<any, Reference>();

    const commands: (number | Reference)[] = [];

    const newref = (src: any, clone: any) => {
        const i = new Reference(table.length);
        table.push(clone);
        indices.set(src, i);
        return i;
    }

    const maybeReplaceAndVisit = (obj: any, key: any) => {
        var value = obj[key];
        if (replacer && value !== undefined) {
            value = replacer.call(obj, key, value);
            if (value === undefined) return undefined;
            if (value instanceof Hole) {
                const holeRef = visit(value.data);
                const holeTarget = newref({}, {});
                commands.push(Opcode.FILL_HOLE, holeTarget, holeRef);
                return holeTarget;
            }
        }
        return visit(value);
    }

    // assign object to slot in table, process if not found, otherwise return index
    const visit = (obj: any): Reference | number => {
        if (obj === undefined) {
            return -1;
        }
        const ref = indices.get(obj);
        if (ref) {
            ref.count++;
            return ref;
        }
        if (isJSONAtom(obj)) {
            return newref(obj, obj);
        }
        var bCmd = Opcode.BUILD_KNOWN;
        var build: [string | number, any[]] | null = toKnownBuilder(obj);
        if (build === null) {
            bCmd = Opcode.BUILD_OTHER;
            build = resolver.toBuilder(obj);
        }
        if (build !== null) {
            const target = newref(obj, {});
            commands.push(bCmd, target, visit(build[0]), visit(build[1].length), ...build[1].map(b => visit(b)));
            return target;
        }
        if (isArray(obj)) {
            const target = newref(obj, []);
            for (var i = 0; i < obj.length; i++) {
                const x = maybeReplaceAndVisit(obj, i);
                if (x !== undefined) commands.push(Opcode.PUSH_ARRAY_ITEM, target, x);
            }
            return target;
        } else { // object
            const target = newref(obj, {});
            for (var key of Object.getOwnPropertyNames(obj)) {
                const x = maybeReplaceAndVisit(obj, key);
                if (x !== undefined) commands.push(Opcode.PROPERTY, target, visit(key), x);
            }
            // Maybe fix prototype
            const constructor = resolver.getConstructorName(obj);
            if (constructor) {
                const proto = Object.getPrototypeOf(obj);
                if (resolver.getPrototype(constructor) !== proto) {
                    throw new SloinkError("Constructor mismatch!");
                } else {
                    commands.push(Opcode.FIX_PROTO, target, visit(constructor));
                }
            }
            return target;
        }
    }
    commands.push(Opcode.RESULT, visit(root));
    // sort references by size
    const allRefs = [...indices.values()].sort((a, b) => b.count - a.count);
    return [encodeCmds(commands.map(c => c instanceof Reference ? allRefs.indexOf(c) + 1 : c)), ...allRefs.map(r => table[r.index])];
}

export const unsloink = (json: any, resolver: Resolver = new NamespaceResolver({}), holeFiller?: HoleFiller) => {
    if (!isArray(json)) return json;
    const s = json[0];
    if (!isString(s)) return json;
    const commands = decodeCmds(s);
    var ip = 0;
    loop: while (ip < commands.length) {
        const cmd = commands[ip++] as Opcode;
        switch (cmd) {
            case Opcode.RESULT: {
                return json[commands[ip++]];
            }
            case Opcode.PROPERTY: {
                const target = json[commands[ip++]];
                const key = json[commands[ip++]];
                const value = json[commands[ip++]];
                target[key] = value;
            } break;
            case Opcode.PUSH_ARRAY_ITEM: {
                const target = json[commands[ip++]];
                const value = json[commands[ip++]];
                target.push(value);
            } break;
            case Opcode.BUILD_KNOWN:
            case Opcode.BUILD_OTHER: {
                const target = commands[ip++];
                const typename = json[commands[ip++]];
                const argc = json[commands[ip++]];
                const argv = [];
                for (var i = 0; i < argc; i++) argv.push(json[commands[ip++]]);
                json[target] = cmd === Opcode.BUILD_KNOWN ? buildKnown(typename, argv) : resolver.build(typename, argv);
            } break;
            case Opcode.FIX_PROTO: {
                const target = json[commands[ip++]];
                const protocode = json[commands[ip++]];
                Object.setPrototypeOf(target, resolver.getPrototype(protocode));
            } break;
            case Opcode.FILL_HOLE: {
                if (!holeFiller) throw new SloinkError("Data has holes but no hole filler provided.");
                const target = commands[ip++];
                const data = json[commands[ip++]];
                json[target] = holeFiller(data);
            } break;
            default:
                cmd satisfies never;
                break loop;
        }
    }
    throw new SloinkError("Corrupted command string!");
}
