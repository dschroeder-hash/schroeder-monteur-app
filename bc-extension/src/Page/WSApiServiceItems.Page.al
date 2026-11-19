/// <summary>
/// Service items (customer machines).
/// </summary>
page 50102 "WS API Service Items"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'serviceItem';
    EntitySetName = 'serviceItems';
    EntityCaption = 'Service Item';
    EntitySetCaption = 'Service Items';
    SourceTable = "Service Item";
    ODataKeyFields = SystemId;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { }
                field(number; Rec."No.") { }
                field(description; Rec.Description) { }
                field(itemNumber; Rec."Item No.") { }
                field(serialNumber; Rec."Serial No.") { }
                field(customerNumber; Rec."Customer No.") { }
                field(serviceItemGroupCode; Rec."Service Item Group Code") { }
                field(manufacturerCode; ManufacturerCode) { }
                field(operatingHours; OperatingHours) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }

    var
        ManufacturerCode: Code[10];
        OperatingHours: Decimal;

    trigger OnAfterGetRecord()
    var
        Item: Record Item;
    begin
        Clear(ManufacturerCode);
        if Rec."Item No." <> '' then
            if Item.Get(Rec."Item No.") then
                ManufacturerCode := Item."Manufacturer Code";

        // OP-20: Operating hours are not a BC standard field. Map to the tenant's
        // field (ISV / own extension) here once known. Until then 0 is returned,
        // which the Monteur-App treats as "unknown".
        OperatingHours := 0;
    end;
}
