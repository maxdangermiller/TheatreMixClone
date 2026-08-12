import BaseModel from './BaseModel';

class Position extends BaseModel {
    id;
    name;
    shortName;
    delay;
    pan;
    buses;
}

export default Position;