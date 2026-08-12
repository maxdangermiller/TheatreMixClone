class BaseModel {
    constructor(data = {}) {
        Object.assign(this, data);
    }

    toJSON() {
        return { ...this };
    }
}

export default BaseModel;