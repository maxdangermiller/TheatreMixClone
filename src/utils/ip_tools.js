/**
 * Convert IP to Octets (ints)
 * @param {String} ip_address 
 * @return {Integer[4]} octets
 */
const convert_ip_to_octets = (ip_address) => {
    // Split the octets
    const split_octs = ip_address.split(".");

    // Make sure there are four octets
    if (split_octs.length !== 4) {
        console.warn("Invalid IP: Does not contain 4 octets, instead contains " + split_octs.length + "!")
        throw new Error("Invalid IP: Does not contain 4 octets, instead contains " + split_octs.length + "!")
        return;
    }

    const octs = [
        parseInt(split_octs[0]), 
        parseInt(split_octs[1]), 
        parseInt(split_octs[2]), 
        parseInt(split_octs[3])
    ]

    if (octs[0] === NaN || octs[1] === NaN || octs[2] === NaN || octs[3] === NaN) {
        console.warn("Invald IP: One or more of the octets are not a number!")
        throw new Error("Invald IP: One or more of the octets are not a number!");
        return;
    }

    // console.log(octs)

    return octs;
}

/**
 * IS IP Address Valid
 * @param {String} ip_address 
 * @returns {boolean} is valid
 */
const is_ip_valid = (ip_address) => {
    if (ip_address === "0.0.0.0")           { return false; }
    if (ip_address === "1.1.1.1")           { return false; }

    let octs = []
    
    try {
        octs = convert_ip_to_octets(ip_address);
    } catch (error) {
        return false;
    }

    if (octs[0] <= 0 || octs[0] > 255)      { return false; }
    if (octs[1] <= 0 || octs[1] > 255)      { return false; }
    if (octs[2] <= 0 || octs[2] > 255)      { return false; }
    if (octs[3] <= 0 || octs[3] > 255)      { return false; }

    return true;
}


/**
 * Check if IP address only contains numbers and periods
 * @param {String} ip_address 
 * @returns {boolean} is valid
 */
const ip_regex = (ip_address) => {
    return !/[^0-9.]/.test(ip_address);
}

export {convert_ip_to_octets, is_ip_valid, ip_regex};