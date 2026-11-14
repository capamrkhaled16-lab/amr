if (typeof Object.hasOwn !== "function") {
  Object.hasOwn = function (obj: object, prop: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
}
