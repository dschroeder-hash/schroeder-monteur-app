/// <summary>
/// Responsibility Centers (read-only).
/// </summary>
page 50105 "WS API Responsibility Centers"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'responsibilityCenter';
    EntitySetName = 'responsibilityCenters';
    EntityCaption = 'responsibilityCenter';
    EntitySetCaption = 'responsibilityCenters';
    SourceTable = "Responsibility Center";
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
                field("code"; Rec.Code) { }
                field(name; Rec.Name) { }
                field(locationCode; Rec."Location Code") { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { }
            }
        }
    }
}
