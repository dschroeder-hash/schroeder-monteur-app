/// <summary>
/// Resources (read-only).
/// </summary>
page 50103 "WS API Resources"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'resource';
    EntitySetName = 'resources';
    EntityCaption = 'resource';
    EntitySetCaption = 'resources';
    SourceTable = Resource;
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
                field(name; Rec.Name) { }
                field(type; Rec.Type) { }
                field(resourceGroupNumber; Rec."Resource Group No.") { }
                field(baseUnitOfMeasureCode; Rec."Base Unit of Measure") { }
                field(blocked; Rec.Blocked) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }
}
