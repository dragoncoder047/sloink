/**
 * Sloink, an object serialization library inspired by Resurrect.js
 *
 * By dragoncoder047
 *
 * @license AGPLv3
 * @version 3.0.0
 */


export class SloinkError extends Error {}

const is = <T>(type: string) => {
    const string = `[object ${type}]`;
    return (obj: any): obj is T => ({}).toString.call(obj) === string;
};

const isBoolean = is<boolean>("Boolean");
const isBigInt = is<bigint>("BigInt");
const isFunction = is<Function>("Function");
const isDate = is<Date>("Date");
const isURL = is<URL>("URL");
const isRegExp = is<RegExp>("RegExp");
const isString = is<string>("String");
const isNumber = is<number>("Number");
const isSet = is<Set<unknown>>("Set");
const isMap = is<Map<unknown, unknown>>("Map");
const isSymbol = is<symbol>("Symbol");

const isJSONAtom = (
    object: any,
): object is string | number | boolean | null => {
    return (
        isString(object) ||
        (isNumber(object) && !(isNaN(object) || !isFinite(object))) ||
        isBoolean(object) ||
        object === null
    );
};
const isPrimitive = (object: any) => {
    return (
        object == null ||
        isNumber(object) ||
        isString(object) ||
        isBoolean(object)
    );
};

const parseHTML = (html: string) => {
    const a = document.createElement("a");
    a.innerHTML = html;
    return a.firstChild as HTMLElement;
};

export abstract class Resolver {
    /**
     * Returns a builder (args to give to a constructor function if the object
     * has hidden state and must be initialized) or null if all the enumerable
     * keys hold the state
     */
    toBuilder(obj: any): [string, any[]] | null {
        return null;
    }
    /** Reverse of {@link toBuilder}, constructs the object from the arguments. */
    build(typeName: string, args: any[]) {
        const type = this.getConstructor(typeName);
        // Brilliant hack by kybernetikos
        const result: any = new (type.bind.apply(
            type,
            [null].concat(args) as [any, any[]],
        ))();
        return isPrimitive(result) ? result.valueOf() : result;
    }
    /**
     * Gets the prototype of the given property name from an object. Should
     * throw an error if not found.
     */
    abstract getPrototype(name: PropertyKey): any;
    /**
     * Gets the prototype name for an object, to be fetched later with
     * {@link getPrototype} and {@link getConstructor}.
     *
     * @returns Null if the constructor is `Object` or `Array`.
     */
    abstract getConstructorName(object: object): PropertyKey | null;
    /** Get the constructor function for the object prototype name. */
    abstract getConstructor(name: string): new (...args: any[]) => any;
}

export class NamespaceResolver extends Resolver {
    constructor(public scope: Record<PropertyKey, new (...args: any[]) => any>) {
        super();
    }
    getPrototype(name: string): any {
        const constructor = this.scope[name];
        if (constructor) {
            return constructor.prototype;
        }
        throw new SloinkError("Unknown constructor: " + name);
    }
    getConstructorName(object: object): PropertyKey | null {
        const constructorFun = object.constructor;
        let constructor =
            Reflect.ownKeys(this.scope).find(
                (realName) => this.scope[realName] === constructorFun,
            ) ?? constructorFun.name;
        if (constructor == null) {
            // IE
            constructor =
                /^\s*function\s*([A-Za-z0-9_$]*)/.exec(
                    "" + constructorFun,
                )?.[1] ?? "";
        }
        if (constructor === "") {
            throw new SloinkError(
                "Can't sloink objects with anonymous constructors.",
            );
        }
        return constructor === "Object" || constructor === "Array"
            ? null
            : constructor;
    }
    getConstructor(name: string): new (...args: any[]) => any {
        return (this.scope[name] ??
            name.split(/\./).reduce((object, name) => {
                return (object as any)[name];
            }, globalThis)) as unknown as new () => any;
    }
}

export class Hole {
    constructor(public data: any) {}
}

export type Replacer = (this: any, key: string | number, obj: any) => any;
export type HoleFiller = (holeData: any) => any;

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

const toKnownBuilder = (
    obj: any,
): [typecode: KnownBuildType, argv: any[]] | null => {
    if (isFunction(obj)) {
        throw new SloinkError("Can't sloink functions.");
    } else if (isMap(obj)) {
        return [KnownBuildType.MAP, [...obj.entries()]];
    } else if (isSet(obj)) {
        return [KnownBuildType.SET, [...obj.values()]];
    } else if ("Node" in globalThis && obj instanceof Node) {
        return [
            KnownBuildType.HTML,
            [new XMLSerializer().serializeToString(obj)],
        ];
    } else if (isDate(obj)) {
        return [KnownBuildType.DATE, [obj.toISOString()]];
    } else if (isURL(obj)) {
        return [KnownBuildType.URL, [obj.href]];
    } else if (isRegExp(obj)) {
        return [KnownBuildType.REGEX, [obj.source, obj.flags]];
    } else if (isNumber(obj) && (isNaN(obj) || !isFinite(obj))) {
        return isNaN(obj)
            ? [KnownBuildType.NAN, []]
            : [KnownBuildType.INFINITY, [obj > 0]];
    } else if (isBigInt(obj)) {
        return [KnownBuildType.BIGINT, ["" + obj]];
    } else if (isSymbol(obj)) {
        const key = Symbol.keyFor(obj);
        if (key === undefined) {
            const key2 = Reflect.ownKeys(Symbol).find((s) => {
                const s2 = Symbol[s as keyof SymbolConstructor];
                return isSymbol(s2) && s2 === obj;
            });
            if (key2 === undefined) {
                throw new SloinkError("Can't sloink uninterned symbols.");
            }
            return [KnownBuildType.WELL_KNOWN_SYMBOL, [key2]];
        }
        return [KnownBuildType.INTERNED_SYMBOL, [key]];
    } else {
        return null;
    }
};

const buildKnown = (typecode: KnownBuildType, argv: any[]) => {
    switch (typecode) {
        case KnownBuildType.MAP:
            return new Map(argv);
        case KnownBuildType.SET:
            return new Set(argv);
        case KnownBuildType.HTML:
            return parseHTML(argv[0]);
        case KnownBuildType.DATE:
            return new Date(argv[0]);
        case KnownBuildType.URL:
            return new URL(argv[0]);
        case KnownBuildType.REGEX:
            return new RegExp(argv[0], argv[1]);
        case KnownBuildType.INFINITY:
            return argv[0] ? Infinity : -Infinity;
        case KnownBuildType.NAN:
            return NaN;
        case KnownBuildType.BIGINT:
            return BigInt(argv[0]);
        case KnownBuildType.INTERNED_SYMBOL:
            return Symbol.for(argv[0]);
        case KnownBuildType.WELL_KNOWN_SYMBOL:
            return Symbol[argv[0] as keyof SymbolConstructor];
        default:
            typecode satisfies never;
            throw new SloinkError("unknown build opcode " + typecode);
    }
};

enum Opcode {
    LITERAL,
    ARRAY,
    OBJECT,
    PROTOTYPE,
    BUILD_KNOWN,
    BUILD_OTHER,
    HOLE_BUILD,
    NEW_REF,
    GET_REF,
}

export const sloink = (
    root: any,
    resolver: Resolver = new NamespaceResolver({}),
    replacer?: Replacer,
) => {
    if (isJSONAtom(root)) return root;

    class Reference {
        constructor(readonly obj: any) {}
        count = 1;
    }

    const references = new Map<any, Reference>();

    const getReplacement = (
        obj: any,
        key: any,
    ): [deleted: boolean, value?: any] => {
        let value = obj[key];
        if (replacer && value !== undefined) {
            value = replacer.call(obj, key, value);
            if (value === undefined) {
                return [true];
            }
        }
        return [false, value];
    };

    const visitReplacement = (value: any) => {
        return value instanceof Hole
            ? [Opcode.HOLE_BUILD, ...visit(value.data)]
            : visit(value);
    };

    const visit = (obj: any): any[] => {
        if (obj === undefined) {
            return [Opcode.GET_REF, -1];
        }

        const ref = references.get(obj);
        if (ref) {
            ref.count++;
            return [ref];
        }
        const myRef = new Reference(obj);
        references.set(obj, myRef);

        if (isJSONAtom(obj)) {
            return [myRef, Opcode.LITERAL, obj];
        }

        let bCmd = Opcode.BUILD_KNOWN;
        let build: [string | number, any[]] | null = toKnownBuilder(obj);
        if (build === null) {
            bCmd = Opcode.BUILD_OTHER;
            build = resolver.toBuilder(obj);
        }
        if (build !== null) {
            return [
                bCmd,
                ...visit(build[0]),
                build[1].length,
                ...build[1].flatMap(visit),
            ];
        }

        if (Array.isArray(obj)) {
            const out: any[] = [myRef, Opcode.ARRAY, 0];
            for (let i = 0; i < obj.length; i++) {
                const [deleted, replacement] = getReplacement(obj, i);
                if (!deleted) {
                    out[2]++;
                    out.push(...visitReplacement(replacement));
                }
            }
            return out;
        } else {
            const out: any[] = [myRef, Opcode.OBJECT, 0];
            const keys = Reflect.ownKeys(obj);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const [deleted, replacement] = getReplacement(obj, key);
                if (!deleted) {
                    out[2]++;
                    out.push(...visit(key), ...visitReplacement(replacement));
                }
            }
            const constructor = resolver.getConstructorName(obj);
            if (constructor) {
                const proto = Reflect.getPrototypeOf(obj);
                if (resolver.getPrototype(constructor) !== proto) {
                    throw new SloinkError("Constructor mismatch!");
                } else {
                    out.unshift(Opcode.PROTOTYPE, ...visit(constructor));
                }
            }
            return out;
        }
    };
    const commandsAndReferences = visit(root);
    const out: any[] = [];
    const refsToIndices = new Map<Reference, number>();
    for (let i = 0; i < commandsAndReferences.length; i++) {
        const item = commandsAndReferences[i]!;
        if (item instanceof Reference) {
            if (item.count > 1) {
                if (refsToIndices.has(item)) {
                    out.push(Opcode.GET_REF, refsToIndices.get(item));
                } else {
                    out.push(
                        Opcode.NEW_REF,
                        refsToIndices.getOrInsert(item, refsToIndices.size),
                    );
                }
            }
        } else {
            out.push(item);
        }
    }
    return out;
};

export const unsloink = (
    json: any,
    resolver: Resolver = new NamespaceResolver({}),
    holeFiller?: HoleFiller,
) => {
    if (!Array.isArray(json)) return json;
    let ip = 0;
    const registers: any[] = [];
    const get = (installRef: (obj: any) => void = () => {}): any => {
        const command = json[ip++] as Opcode;
        switch (command) {
            case Opcode.LITERAL: {
                const value = json[ip++];
                installRef(value);
                return value;
            }
            case Opcode.ARRAY: {
                const elements = json[ip++] as number;
                const out: any[] = Array(elements);
                installRef(out);
                for (let i = 0; i < elements; i++) out[i] = get();
                return out;
            }
            case Opcode.OBJECT: {
                const pairs = json[ip++] as number;
                const out: any = {};
                installRef(out);
                for (let i = 0; i < pairs; i++) {
                    const key = get();
                    const val = get();
                    out[key] = val;
                }
                return out;
            }
            case Opcode.PROTOTYPE: {
                const typecode = get();
                const obj = get();
                Reflect.setPrototypeOf(obj, resolver.getPrototype(typecode));
                return obj;
            }
            case Opcode.BUILD_KNOWN:
            case Opcode.BUILD_OTHER: {
                const typecode = get();
                const argc = json[ip++];
                const argv: any[] = [];
                for (let i = 0; i < argc; i++) argv[i] = get();
                return command === Opcode.BUILD_KNOWN
                    ? buildKnown(typecode, argv)
                    : resolver.build(typecode, argv);
            }
            case Opcode.HOLE_BUILD: {
                if (!holeFiller) {
                    throw new SloinkError(
                        "Data has holes but no hole filler provided.",
                    );
                }
                return holeFiller(get());
            }
            case Opcode.NEW_REF: {
                const slot = json[ip++];
                return get((obj) => (registers[slot] = obj));
            }
            case Opcode.GET_REF: {
                const slot = json[ip++];
                return registers[slot];
            }
            default: {
                throw new SloinkError("Corrupted command array!");
            }
        }
    };
    return get();
};
