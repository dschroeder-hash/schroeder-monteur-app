/// <summary>
/// Item References (read-only).
/// </summary>
page 50108 "WS API Item References"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'itemReference';
    EntitySetName = 'itemReferences';
    EntityCaption = 'itemReference';
    EntitySetCaption = 'itemReferences';
    SourceTable = "Item Reference";
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
                field(itemNumber; Rec."Item No.") { }
                // Blank reference type is serialized by BC as "_x0020_".
                field(referenceType; Rec."Reference Type") { }
                field(referenceNumber; Rec."Reference No.") { }
                field(unitOfMeasure; Rec."Unit of Measure") { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }
}
